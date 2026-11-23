import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callClaude, extractJson, httpError } from './claude.js';
import { renderCvPdf } from './cvpdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 30 }));
// Serve the web UI too (handy for testing in a browser)
app.use(express.static(path.join(__dirname, '..', 'web')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 10 } });

// Optional shared access code so strangers can't burn your Anthropic credits.
app.use('/api/', (req, res, next) => {
  const code = process.env.ACCESS_CODE;
  if (code && req.get('x-access-code') !== code) return res.status(401).json({ error: 'Invalid access code' });
  next();
});

const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  ai: !!process.env.ANTHROPIC_API_KEY,
  email: !!process.env.SMTP_HOST,
}));

// ---------- 1. Read certificates -> structured profile ----------
const EXTRACT_SYSTEM = `You read Nigerian academic and professional documents (WAEC/NECO results, university degree certificates, NYSC discharge/exemption certificates, transcripts, professional body certificates such as ICAN, COREN, NMCN, CIPM, and existing CVs, plus ID pages).
Extract ONLY what is actually written in the documents. Never invent or guess a value; use null when something is not visible. Keep names in the exact spelling shown.
Reply with a single JSON object, no commentary:
{
 "fullName": string|null, "dateOfBirth": string|null, "gender": string|null, "stateOfOrigin": string|null,
 "email": string|null, "phone": string|null, "address": string|null,
 "education": [{"institution": string, "qualification": string, "field": string|null, "classOfDegree": string|null, "years": string|null, "matricNo": string|null}],
 "secondary": [{"exam": "WAEC"|"NECO"|"Other", "year": string|null, "results": [{"subject": string, "grade": string}]}],
 "nysc": {"status": string, "year": string|null, "callUpNo": string|null}|null,
 "certifications": [{"name": string, "issuer": string|null, "year": string|null}],
 "experience": [{"role": string, "organisation": string|null, "period": string|null, "bullets": [string]}],
 "skills": [string],
 "profession": string|null,
 "documentsRead": [{"file": string, "type": string}]
}
"profession" is the single best job-search title implied by the highest qualification (e.g. "Civil Engineer", "Accountant", "Registered Nurse").`;

app.post('/api/profile/extract', upload.array('files', 10), wrap(async (req, res) => {
  if (!req.files?.length) throw httpError(400, 'Upload at least one document');
  const content = [];
  for (const f of req.files) {
    const b64 = f.buffer.toString('base64');
    if (f.mimetype === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } });
    else if (/^image\/(jpeg|png|webp|gif)$/.test(f.mimetype)) content.push({ type: 'image', source: { type: 'base64', media_type: f.mimetype, data: b64 } });
    else throw httpError(400, `Unsupported file type for ${f.originalname}. Use PDF, JPG or PNG.`);
    content.push({ type: 'text', text: `(File name above: ${f.originalname})` });
  }
  content.push({ type: 'text', text: 'Extract the profile JSON from these documents.' });
  const reply = await callClaude({ system: EXTRACT_SYSTEM, content, maxTokens: 8000 });
  res.json({ profile: extractJson(reply) });
}));

// ---------- 2. Profile -> CV ----------
const CV_SYSTEM = `You write professional CVs for Nigerian graduates, in the style Nigerian employers expect (clear, one-column, factual).
Use ONLY facts present in the supplied profile. Do not invent employers, dates, grades or skills. You may write a short professional summary and tidy bullet wording, and list skills that are directly implied by the qualification/experience.
If the profile has WAEC/NECO results, mention them in one education line only if they are strong (credits in English and Mathematics). Include NYSC status in certifications when present.
Reply with a single JSON object, no commentary:
{"fullName","email","phone","location","links":[],"summary","education":[{"institution","qualification","field","classOfDegree","years"}],"certifications":[{"name","issuer","year"}],"experience":[{"role","organisation","period","bullets":[]}],"skills":[],"referees":"Available on request"}`;

app.post('/api/cv', wrap(async (req, res) => {
  const { profile } = req.body || {};
  if (!profile) throw httpError(400, 'profile is required');
  const reply = await callClaude({ system: CV_SYSTEM, content: [{ type: 'text', text: JSON.stringify(profile) }], maxTokens: 8000 });
  res.json({ cv: extractJson(reply) });
}));

app.post('/api/cv/pdf', wrap(async (req, res) => {
  const { cv } = req.body || {};
  if (!cv) throw httpError(400, 'cv is required');
  const pdf = await renderCvPdf(cv);
  res.set({ 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="CV.pdf"' }).send(pdf);
}));

// ---------- 3. Find real vacancies ----------
const JOBS_SYSTEM = `You are a job-research assistant for Nigerian graduates. Use the web_search tool to find CURRENT, OPEN vacancies in Nigeria (including remote roles open to Nigerians) for the given profession and qualification.
Search several times: Nigerian job boards (MyJobMag, Jobberman, HotNigerianJobs, NgCareers, LinkedIn), employer career pages, university/hospital/agency/bank/oil & gas recruitment pages, and graduate trainee programmes.
STRICT RULES: only return vacancies you actually saw in search results. Never invent an employer, URL or email address. "applyUrl" must be a URL from the results. "applyEmail" only if an application email address is explicitly printed in the listing, otherwise null. Skip listings whose deadline has clearly passed or that ask for fees from applicants (a common scam).
Reply with ONLY a JSON array (max 12 items), most relevant first:
[{"title","employer","location","deadline":string|null,"summary":"one sentence on requirements","applyUrl","applyEmail":string|null,"fitReason":"why this suits the graduate"}]`;

app.post('/api/jobs/search', wrap(async (req, res) => {
  const { profile, location } = req.body || {};
  if (!profile) throw httpError(400, 'profile is required');
  const q = {
    profession: profile.profession, education: (profile.education || []).slice(0, 3),
    skills: (profile.skills || []).slice(0, 15), nysc: profile.nysc?.status || null, preferredLocation: location || 'Nigeria',
  };
  const reply = await callClaude({
    system: JOBS_SYSTEM,
    content: [{ type: 'text', text: `Today is ${new Date().toISOString().slice(0, 10)}. Find open vacancies for: ${JSON.stringify(q)}` }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'NG' } }],
    maxTokens: 16000,
  });
  const jobs = extractJson(reply);
  res.json({ jobs: (Array.isArray(jobs) ? jobs : []).filter(j => j && j.title && j.applyUrl) });
}));

// ---------- 4. Apply ----------
const COVER_SYSTEM = `Write a concise, polite cover letter (150-220 words) for a Nigerian graduate applying to the given vacancy. Use only facts in the profile/CV; do not invent experience. Start with "Dear Hiring Manager," and end with the graduate's full name. Plain text only, no markdown, no subject line.`;

async function coverLetter(profile, cv, job) {
  return (await callClaude({
    system: COVER_SYSTEM,
    content: [{ type: 'text', text: JSON.stringify({ profile, cv, job: { title: job.title, employer: job.employer, summary: job.summary } }) }],
    maxTokens: 4000, effort: 'low',
  })).trim();
}

let transport;
function mailer() {
  if (!process.env.SMTP_HOST) return null;
  transport ||= nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

app.post('/api/apply', wrap(async (req, res) => {
  const { profile, cv, job, consent } = req.body || {};
  if (!profile || !cv || !job) throw httpError(400, 'profile, cv and job are required');
  if (consent !== true) throw httpError(400, 'The graduate must approve each application');
  const letter = await coverLetter(profile, cv, job);

  const to = job.applyEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.applyEmail) ? job.applyEmail : null;
  const smtp = mailer();
  const graduateEmail = cv.email || profile.email;
  if (!to || !smtp || !graduateEmail) {
    // Portal-only vacancy (or email not configured): hand back everything ready to paste/upload.
    return res.json({ status: 'manual', reason: !to ? 'This employer uses an online portal, not email' : !smtp ? 'Server email is not configured' : 'Your email address is missing from your profile',
      coverLetter: letter, applyUrl: job.applyUrl });
  }
  const pdf = await renderCvPdf(cv);
  const name = (cv.fullName || profile.fullName || 'Applicant').replace(/[^\w .-]/g, '');
  await smtp.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    replyTo: `${name} <${graduateEmail}>`,
    to,
    subject: `Application for ${job.title} - ${name}`,
    text: `${letter}\n\n--\nSent on behalf of ${name} via NaijaGrad Jobs. Reply to this email to reach the applicant directly at ${graduateEmail}${cv.phone ? ' / ' + cv.phone : ''}.`,
    attachments: [{ filename: `${name} - CV.pdf`, content: pdf, contentType: 'application/pdf' }],
  });
  res.json({ status: 'sent', to, coverLetter: letter });
}));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 8787;
  app.listen(port, () => console.log(`NaijaGrad Jobs backend on :${port}  ai=${!!process.env.ANTHROPIC_API_KEY} email=${!!process.env.SMTP_HOST}`));
}
