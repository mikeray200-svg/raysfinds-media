// Claude calls via the official Anthropic SDK.
import Anthropic from '@anthropic-ai/sdk';

export function model() { return process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'; }

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw httpError(500, 'Server has no ANTHROPIC_API_KEY configured');
  // ANTHROPIC_API_URL is only used by the tests (mock server).
  client ||= new Anthropic({ ...(process.env.ANTHROPIC_API_URL ? { baseURL: process.env.ANTHROPIC_API_URL } : {}), maxRetries: 2 });
  return client;
}

const MAX_CONTINUATIONS = 5;

/**
 * One Claude request. Handles:
 *  - pause_turn (long web searches): re-sends the assistant turn so the server resumes
 *  - refusal fallbacks: server-side `fallbacks: "default"` re-runs a declined request on a fallback model
 * Returns the text of the final assistant turn.
 */
export async function callClaude({ system, content, tools, maxTokens = 16000, effort = 'medium' }) {
  const c = getClient();
  const messages = [{ role: 'user', content }];
  let response;
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    try {
      response = await c.beta.messages.create({
        model: model(),
        max_tokens: maxTokens,
        system,
        messages,
        ...(tools ? { tools } : {}),
        thinking: { type: 'adaptive' },
        output_config: { effort },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw httpError(500, 'The server\'s Anthropic API key is invalid');
      if (err instanceof Anthropic.RateLimitError) throw httpError(503, 'The AI service is busy. Please try again in a minute.');
      if (err instanceof Anthropic.APIStatusError) throw httpError(502, `AI service error ${err.status}: ${err.message}`);
      if (err instanceof Anthropic.APIConnectionError) throw httpError(502, 'Could not reach the AI service');
      throw err;
    }
    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }
  if (response.stop_reason === 'refusal') throw httpError(422, 'The AI declined this request. Please check your documents and try again.');
  const texts = (response.content || []).filter(b => b.type === 'text').map(b => b.text);
  if (!texts.length) throw httpError(502, 'The AI returned no answer');
  return texts.join('\n');
}

// Pull a JSON object/array out of a model reply. Tries the LAST candidate first, since earlier
// text (e.g. "I'll search [several boards]...") can contain stray brackets.
export function extractJson(text) {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
  for (const f of fenced.reverse()) { try { return JSON.parse(f.trim()); } catch {} }
  const starts = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '{' || text[i] === '[') starts.push(i);
  for (const start of starts) {
    const v = scan(text, start);
    if (v !== undefined && (typeof v === 'object')) {
      // Prefer the largest JSON value: skip tiny ones like [1] if a later, bigger one exists.
      if (Array.isArray(v) ? v.length && typeof v[0] === 'object' : Object.keys(v).length) return v;
    }
  }
  throw httpError(502, 'The AI reply could not be read. Please try again.');
}

function scan(src, start) {
  const open = src[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) { try { return JSON.parse(src.slice(start, i + 1)); } catch { return undefined; } }
  }
  return undefined;
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
