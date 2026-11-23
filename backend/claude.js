// Thin wrapper over the Anthropic Messages API (no SDK needed).
const API = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';

export function model() { return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'; }

export async function callClaude({ system, content, tools, maxTokens = 4096 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'Server has no ANTHROPIC_API_KEY configured');
  const body = { model: model(), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  if (tools) body.tools = tools;
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(502, `Anthropic API error ${res.status}: ${data?.error?.message || 'unknown'}`);
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// Pull the first JSON object/array out of a model reply (handles ```json fences and chatter).
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : text;
  const starts = [src.indexOf('{'), src.indexOf('[')].filter(i => i >= 0);
  if (!starts.length) throw httpError(502, 'Model reply contained no JSON');
  const start = Math.min(...starts);
  const open = src[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw httpError(502, 'Model reply had unterminated JSON');
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
