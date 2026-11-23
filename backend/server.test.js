import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Mock Anthropic: replies depend on what the system prompt is about.
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    const j = JSON.parse(b); const sys = j.system; let text;
    if (sys.includes('read Nigerian academic')) text = '```json\n' + JSON.stringify({ fullName: 'Ada Obi', email: null, phone: null, profession: 'Civil Engineer', education: [{ institution: 'University of Lagos', qualification: 'B.Eng', field: 'Civil Engineering', classOfDegree: 'Second Class Upper', years: '2018-2023' }], skills: ['AutoCAD'], certifications: [] }) + '\n```';
    else if (sys.includes('write professional CVs')) text = JSON.stringify({ fullName: 'Ada Obi', email: 'ada@example.com', summary: 'Graduate civil engineer.', education: [{ institution: 'UNILAG', qualification: 'B.Eng', field: 'Civil Engineering', years: '2018-2023' }], skills: ['AutoCAD'], experience: [] });
    else if (sys.includes('job-research')) { assert.equal(j.tools[0].name, 'web_search'); text = 'Here you go: [{"title":"Graduate Engineer","employer":"Acme Ltd","location":"Lagos","applyUrl":"https://acme.ng/jobs/1","applyEmail":null,"summary":"BEng","fitReason":"match"},{"title":"bad","employer":"x"}]'; }
    else text = 'Dear Hiring Manager,\n\nI am applying.\n\nAda Obi';
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
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
