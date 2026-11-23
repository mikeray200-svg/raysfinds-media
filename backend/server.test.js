import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Mock Anthropic: replies depend on what the system prompt is about.
let jobCalls = 0; const seen = [];
const msg = (content, stop_reason = 'end_turn') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b); seen.push({ j, beta: req.headers['anthropic-beta'] }); const sys = j.system; let out;
    if (sys.includes('read Nigerian academic')) {
      if (JSON.stringify(j.messages).includes('refuse-me')) out = msg([], 'refusal');
      else out = msg([{ type: 'text', text: '```json\n' + JSON.stringify({ fullName: 'Ada Obi', email: null, phone: null, profession: 'Civil Engineer', education: [{ institution: 'University of Lagos', qualification: 'B.Eng', field: 'Civil Engineering', classOfDegree: 'Second Class Upper', years: '2018-2023' }], skills: ['AutoCAD'], certifications: [] }) + '\n```' }]);
    }
    else if (sys.includes('write professional CVs')) out = msg([{ type: 'text', text: JSON.stringify({ fullName: 'Ada Obi', email: 'ada@example.com', summary: 'Graduate civil engineer.', education: [{ institution: 'UNILAG', qualification: 'B.Eng', field: 'Civil Engineering', years: '2018-2023' }], skills: ['AutoCAD'], experience: [] }) }]);
    else if (sys.includes('job-research')) {
      assert.equal(j.tools[0].type, 'web_search_20260209');
      jobCalls++;
      // First call pauses mid-search (long server-side loop); second call finishes.
      if (j.messages.length === 1) out = msg([{ type: 'text', text: "I'll search [several] boards." }, { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'graduate civil engineer jobs Nigeria' } }], 'pause_turn');
      else out = msg([{ type: 'text', text: 'Here you go: [{"title":"Graduate Engineer","employer":"Acme Ltd","location":"Lagos","applyUrl":"https://acme.ng/jobs/1","applyEmail":null,"summary":"BEng","fitReason":"match"},{"title":"bad","employer":"x"}]' }]);
    }
    else out = msg([{ type: 'text', text: 'Dear Hiring Manager,\n\nI am applying.\n\nAda Obi' }]);
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(out));
  });
});
await new Promise(r => mock.listen(0, r));
process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.ANTHROPIC_API_KEY = 'test';
const { app } = await import('./server.js');
const srv = await new Promise(r => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
test.after(() => { srv.close(); mock.close(); });

test('extract profile from uploaded pdf', async () => {
  const fd = new FormData(); fd.append('files', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'degree.pdf');
  const r = await fetch(base + '/api/profile/extract', { method: 'POST', body: fd });
  assert.equal(r.status, 200); const { profile } = await r.json();
  assert.equal(profile.fullName, 'Ada Obi'); assert.equal(profile.profession, 'Civil Engineer');
});
test('rejects unsupported file type', async () => {
  const fd = new FormData(); fd.append('files', new Blob(['x'], { type: 'text/plain' }), 'a.txt');
  assert.equal((await fetch(base + '/api/profile/extract', { method: 'POST', body: fd })).status, 400);
});
test('cv + pdf render', async () => {
  const { cv } = await (await post('/api/cv', { profile: { fullName: 'Ada Obi' } })).json();
  assert.equal(cv.fullName, 'Ada Obi');
  const r = await post('/api/cv/pdf', { cv }); const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
});
test('job search filters junk and parses fenced/chatty JSON', async () => {
  const { jobs } = await (await post('/api/jobs/search', { profile: { profession: 'Civil Engineer' } })).json();
  assert.equal(jobs.length, 1); assert.equal(jobs[0].applyUrl, 'https://acme.ng/jobs/1');
  assert.equal(jobCalls, 2, 'pause_turn should be resumed once');
});
test('requests use adaptive thinking and server-side refusal fallbacks', () => {
  const { j, beta } = seen[0];
  assert.equal(j.model, 'claude-opus-5-5'); assert.deepEqual(j.thinking, { type: 'adaptive' });
  assert.equal(j.fallbacks, 'default'); assert.match(beta, /server-side-fallback-2026-07-01/);
});
test('refusal becomes a friendly 422', async () => {
  const fd = new FormData(); fd.append('files', new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' }), 'refuse-me.pdf');
  const r = await fetch(base + '/api/profile/extract', { method: 'POST', body: fd });
  assert.equal(r.status, 422); assert.match((await r.json()).error, /declined/);
});
test('apply requires consent', async () => {
  assert.equal((await post('/api/apply', { profile: {}, cv: {}, job: {} })).status, 400);
});
test('apply falls back to manual for portal-only job', async () => {
  const job = { title: 'Graduate Engineer', employer: 'Acme', applyUrl: 'https://acme.ng/jobs/1', applyEmail: null };
  const r = await (await post('/api/apply', { profile: {}, cv: { email: 'a@b.co' }, job, consent: true })).json();
  assert.equal(r.status, 'manual'); assert.match(r.coverLetter, /Dear Hiring Manager/);
});
test('access code enforced when set', async () => {
  process.env.ACCESS_CODE = 'sesame';
  assert.equal((await fetch(base + '/api/health')).status, 401);
  assert.equal((await fetch(base + '/api/health', { headers: { 'x-access-code': 'sesame' } })).status, 200);
  delete process.env.ACCESS_CODE;
});
