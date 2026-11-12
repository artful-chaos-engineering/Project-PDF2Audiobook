import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { processPdf } from './processPdf';
import { getConfig } from './config';
import { AUDIENCES, MODES, parseMode, Mode } from './modes';

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

if (!process.env.ELEVENLABS_API_KEY || !process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY and ANTHROPIC_API_KEY must be set (see .env)');
  process.exit(1);
}

const config = getConfig();

interface Job {
  id: string;
  file: string;
  mode: Mode;
  status: 'running' | 'done' | 'failed';
  step: number;
  sectionsDone: number;
  sectionsTotal: number;
  log: string[];
  startedAt: number;
  finishedAt?: number;
  result?: { url: string; file: string; sections: number; durationSeconds: number; sizeBytes: number };
  error?: string;
}

const jobs = new Map<string, Job>();
let activeJob: Job | null = null;

const MODE_INFO: Record<string, string> = {
  narration: 'One voice reads the cleaned text, section by section.',
  podcast: 'Two hosts discuss the material in a conversational show.',
  debate: 'Two speakers argue for and against the ideas in the text.',
  summary: 'A short spoken overview of the key points.',
  'deep-dive': 'A long, thorough two-voice walk through every section.',
};

function describeMode(m: string): string {
  const audience = AUDIENCES.find(a => m.startsWith(`${a}-`));
  const format = audience ? m.slice(audience.length + 1) : m;
  const base = MODE_INFO[format] || '';
  return audience ? `${base} Pitched at a ${audience} listener.` : base;
}

function modeOptions(): string {
  const general = MODES.filter(m => !AUDIENCES.some(a => m.startsWith(`${a}-`)));
  const groups: [string, readonly string[]][] = [
    ['General', general],
    ...AUDIENCES.map(a => [a[0].toUpperCase() + a.slice(1), MODES.filter(m => m.startsWith(`${a}-`))] as [string, string[]]),
  ];
  return groups.map(([label, ms]) =>
    `<optgroup label="${label}">${ms.map(m => `<option value="${m}" data-desc="${describeMode(m)}">${m}</option>`).join('')}</optgroup>`
  ).join('');
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF to Audiobook</title>
<style>
:root { --bg:#f6f8fa; --card:#fff; --fg:#1a1a1a; --muted:#656d76; --accent:#1f6feb; --line:#d0d7de; --ok:#1a7f37; --err:#cf222e; --errbg:#ffebe9; --okbg:#dafbe1; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0d1117; --card:#161b22; --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --line:#30363d; --ok:#3fb950; --err:#f85149; --errbg:#3a1d1f; --okbg:#12261a; } }
:root[data-theme="dark"] { --bg:#0d1117; --card:#161b22; --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --line:#30363d; --ok:#3fb950; --err:#f85149; --errbg:#3a1d1f; --okbg:#12261a; }
* { box-sizing:border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font-family:system-ui,sans-serif; line-height:1.45; }
main { max-width:720px; margin:0 auto; }
header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
h1 { font-size:1.4rem; margin:8px 0; }
h2 { font-size:1.05rem; margin:0 0 12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-top:16px; }
.drop { border:2px dashed var(--line); border-radius:8px; padding:24px; text-align:center; cursor:pointer; color:var(--muted); }
.drop.over { border-color:var(--accent); color:var(--fg); }
.drop strong { color:var(--fg); word-break:break-all; }
label { display:block; font-weight:600; margin:14px 0 6px; }
select { width:100%; padding:8px; border-radius:6px; border:1px solid var(--line); background:var(--card); color:var(--fg); font-size:1rem; }
.hint { color:var(--muted); font-size:.9rem; margin-top:6px; }
.actions { margin-top:16px; display:flex; gap:8px; }
button { font:inherit; cursor:pointer; }
.primary { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:10px 18px; font-size:1rem; }
.primary:disabled { opacity:.5; cursor:default; }
.ghost { background:none; border:1px solid var(--line); color:var(--fg); border-radius:6px; padding:6px 10px; }
.steps { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
.steps li { display:flex; gap:8px; align-items:center; color:var(--muted); }
.steps li::before { content:'○'; width:1.2em; text-align:center; }
.steps li.active { color:var(--fg); font-weight:600; }
.steps li.active::before { content:'◐'; color:var(--accent); }
.steps li.done::before { content:'●'; color:var(--ok); }
progress { width:100%; height:8px; margin-top:12px; }
.meta { display:flex; justify-content:space-between; color:var(--muted); font-size:.9rem; margin-top:6px; }
details { margin-top:12px; }
pre { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:10px; max-height:220px; overflow:auto; font-size:.8rem; white-space:pre-wrap; margin:8px 0 0; }
.msg { position:relative; border-radius:8px; padding:12px 44px 12px 14px; margin-top:16px; border:1px solid var(--line); }
.msg.error { background:var(--errbg); border-color:var(--err); }
.msg.success { background:var(--okbg); border-color:var(--ok); }
.msg.info { background:var(--card); }
.msg .close { position:absolute; top:8px; right:8px; background:none; border:0; color:var(--fg); font-size:1.2rem; line-height:1; padding:4px 8px; border-radius:4px; }
.msg .close:hover, .msg .close:focus-visible { background:var(--line); }
audio { width:100%; margin-top:10px; }
.lib { list-style:none; padding:0; margin:0; }
.lib li { border-top:1px solid var(--line); padding:10px 0; }
.lib li:first-child { border-top:0; }
.lib .row { display:flex; justify-content:space-between; gap:8px; align-items:center; flex-wrap:wrap; }
.lib .name { font-weight:600; word-break:break-all; }
.lib .info { color:var(--muted); font-size:.85rem; }
.lib a { color:var(--accent); }
.empty { color:var(--muted); }
[hidden] { display:none !important; }
</style>
</head>
<body>
<main>
<header>
<h1>PDF to Audiobook</h1>
<button class="ghost" id="theme" aria-label="Toggle theme">Theme</button>
</header>

<div id="messages" aria-live="polite"></div>

<section class="card" id="form">
<h2>New conversion</h2>
<div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose a PDF">
<div id="dropText">Drop a PDF here or click to choose (max 50 MB)</div>
</div>
<input type="file" id="pdf" accept="application/pdf" hidden>
<label for="mode">Mode</label>
<select id="mode">${modeOptions()}</select>
<div class="hint" id="modeDesc"></div>
<div class="actions"><button class="primary" id="go" disabled>Convert</button></div>
</section>

<section class="card" id="progressCard" hidden>
<h2 id="jobTitle">Converting</h2>
<ol class="steps" id="steps">
<li>Extract text from PDF</li>
<li>Clean sections with Claude</li>
<li>Build script</li>
<li>Generate audio</li>
</ol>
<progress id="bar" max="100" value="0"></progress>
<div class="meta"><span id="stepInfo"></span><span id="elapsed">0:00</span></div>
<details><summary>Log</summary><pre id="log"></pre></details>
</section>

<section class="card">
<div class="row" style="display:flex;justify-content:space-between;align-items:center">
<h2 style="margin:0">Library</h2>
<button class="ghost" id="refresh">Refresh</button>
</div>
<ul class="lib" id="lib" style="margin-top:12px"></ul>
</section>
</main>
<script>
const $ = id => document.getElementById(id);
const pdf = $('pdf'), go = $('go'), drop = $('drop'), mode = $('mode');
let file = null, timer = null;

try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
$('theme').onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
};

function showMessage(kind, text) {
  const box = document.createElement('div');
  box.className = 'msg ' + kind;
  box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const span = document.createElement('span');
  span.textContent = text;
  const close = document.createElement('button');
  close.className = 'close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.onclick = () => box.remove();
  box.append(span, close);
  $('messages').prepend(box);
}

function fmtTime(s) { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); }
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }

function updateDesc() { $('modeDesc').textContent = mode.selectedOptions[0]?.dataset.desc || ''; }
mode.onchange = () => { updateDesc(); try { localStorage.setItem('mode', mode.value); } catch {} };
try { const m = localStorage.getItem('mode'); if (m && [...mode.options].some(o => o.value === m)) mode.value = m; } catch {}
updateDesc();

function setFile(f) {
  if (!f) return;
  if (!/\\.pdf$/i.test(f.name)) { showMessage('error', f.name + ' is not a PDF.'); return; }
  if (f.size > 50 * 1024 * 1024) { showMessage('error', f.name + ' is larger than 50 MB.'); return; }
  file = f;
  $('dropText').innerHTML = '';
  const s = document.createElement('strong'); s.textContent = f.name;
  $('dropText').append(s, document.createTextNode(' (' + fmtSize(f.size) + ') — click to change'));
  go.disabled = false;
}
drop.onclick = () => pdf.click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pdf.click(); } };
pdf.onchange = () => setFile(pdf.files[0]);
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));

function renderJob(job) {
  $('progressCard').hidden = false;
  $('jobTitle').textContent = (job.status === 'running' ? 'Converting ' : job.status === 'done' ? 'Finished ' : 'Failed ') + job.file + ' (' + job.mode + ')';
  [...$('steps').children].forEach((li, i) => {
    const n = i + 1;
    li.className = job.status === 'done' || n < job.step ? 'done' : n === job.step && job.status === 'running' ? 'active' : '';
  });
  let pct = job.status === 'done' ? 100 : Math.max(0, job.step - 1) * 25;
  if (job.step === 2 && job.sectionsTotal) pct = 25 + 25 * job.sectionsDone / job.sectionsTotal;
  $('bar').value = pct;
  $('stepInfo').textContent = job.step === 2 && job.sectionsTotal ? 'Section ' + job.sectionsDone + ' of ' + job.sectionsTotal : job.status === 'running' ? 'Step ' + job.step + ' of 4' : '';
  const end = job.finishedAt || Date.now();
  $('elapsed').textContent = fmtTime((end - job.startedAt) / 1000);
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.textContent = job.log.join('\\n');
  if (atBottom) log.scrollTop = log.scrollHeight;
}

async function poll(id) {
  clearTimeout(timer);
  try {
    const res = await fetch('/jobs/' + id);
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || res.statusText);
    renderJob(job);
    if (job.status === 'running') { timer = setTimeout(() => poll(id), 1500); return; }
    go.disabled = !file;
    if (job.status === 'done') {
      showMessage('success', 'Done: ' + job.result.file + ' — ' + job.result.sections + ' sections, ' + fmtTime(job.result.durationSeconds) + '.');
      loadLibrary(job.result.file);
    } else {
      showMessage('error', 'Conversion failed: ' + job.error);
    }
  } catch (err) {
    showMessage('error', 'Lost contact with the server: ' + err.message);
    timer = setTimeout(() => poll(id), 5000);
  }
}

go.onclick = async () => {
  if (!file) return;
  go.disabled = true;
  try {
    const res = await fetch('/convert', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Mode': mode.value }, body: file });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showMessage('info', 'Started ' + file.name + '. It takes about as long as the audio plays, plus processing. You can leave this page and come back.');
    poll(data.id);
  } catch (err) {
    showMessage('error', err.message);
    go.disabled = false;
  }
};

async function loadLibrary(highlight) {
  const lib = $('lib');
  try {
    const res = await fetch('/library');
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || res.statusText);
    lib.innerHTML = '';
    if (!items.length) { lib.innerHTML = '<li class="empty">No audiobooks yet.</li>'; return; }
    for (const it of items) {
      const li = document.createElement('li');
      const row = document.createElement('div'); row.className = 'row';
      const left = document.createElement('div');
      const name = document.createElement('div'); name.className = 'name'; name.textContent = it.file;
      const info = document.createElement('div'); info.className = 'info'; info.textContent = fmtSize(it.sizeBytes) + ' · ' + new Date(it.modified).toLocaleString();
      left.append(name, info);
      const right = document.createElement('div');
      const play = document.createElement('button'); play.className = 'ghost'; play.textContent = 'Play';
      const dl = document.createElement('a'); dl.href = it.url + '?download=1'; dl.download = it.file; dl.textContent = 'Download'; dl.style.marginLeft = '10px';
      right.append(play, dl);
      row.append(left, right);
      li.append(row);
      const addPlayer = () => {
        if (li.querySelector('audio')) return;
        const a = document.createElement('audio'); a.controls = true; a.src = it.url; li.append(a); return a;
      };
      play.onclick = () => { const a = addPlayer(); if (a) a.play().catch(() => {}); play.hidden = true; };
      if (it.file === highlight) { addPlayer(); play.hidden = true; }
      lib.append(li);
    }
  } catch (err) {
    showMessage('error', 'Could not load library: ' + err.message);
  }
}
$('refresh').onclick = () => loadLibrary();

(async () => {
  loadLibrary();
  try {
    const res = await fetch('/jobs/active');
    if (res.ok) { const job = await res.json(); if (job && job.id) { go.disabled = true; poll(job.id); } }
  } catch {}
})();
</script>
</body>
</html>`;

function sendJson(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('Upload exceeds 50 MB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function trackProgress(job: Job, msg: string) {
  console.log(msg);
  job.log.push(msg);
  const step = msg.match(/^([1-4])️?⃣/u);
  if (step) job.step = Number(step[1]);
  const total = msg.match(/of (\d+) sections/);
  if (total) job.sectionsTotal = Number(total[1]);
  const sec = msg.match(/Section (\d+)\/(\d+)/);
  if (sec) { job.sectionsDone = Number(sec[1]); job.sectionsTotal = Number(sec[2]); }
}

async function runJob(job: Job, inputPath: string) {
  try {
    const result = await processPdf(inputPath, config.outputDir, job.mode, msg => trackProgress(job, msg));
    const file = path.basename(result.outputPath);
    job.result = {
      url: '/output/' + encodeURIComponent(file),
      file,
      sections: result.sectionCount,
      durationSeconds: result.durationSeconds,
      sizeBytes: result.sizeBytes,
    };
    job.status = 'done';
  } catch (err) {
    job.error = err instanceof Error ? err.message : String(err);
    job.log.push('ERROR: ' + job.error);
    job.status = 'failed';
  } finally {
    job.finishedAt = Date.now();
    activeJob = null;
  }
}

async function handleConvert(req: http.IncomingMessage, res: http.ServerResponse) {
  if (activeJob) return sendJson(res, 409, { error: `A conversion of ${activeJob.file} is already running. Wait for it to finish.` });

  const rawName = decodeURIComponent(String(req.headers['x-filename'] || ''));
  const baseName = path.basename(rawName).replace(/[^A-Za-z0-9._ -]/g, '_');
  if (!/\.pdf$/i.test(baseName)) return sendJson(res, 400, { error: 'Upload a .pdf file.' });

  let mode: Mode;
  try {
    mode = parseMode(String(req.headers['x-mode'] || ''));
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, 413, { error: err instanceof Error ? err.message : String(err) });
  }
  if (body.length < 5 || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return sendJson(res, 400, { error: 'File is not a PDF.' });
  }
  if (activeJob) return sendJson(res, 409, { error: `A conversion of ${(activeJob as Job).file} is already running.` });

  const inputPath = path.join(config.inputDir, baseName);
  fs.writeFileSync(inputPath, body);
  const job: Job = {
    id: randomUUID(), file: baseName, mode, status: 'running', step: 0,
    sectionsDone: 0, sectionsTotal: 0, log: [], startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  activeJob = job;
  void runJob(job, inputPath);
  sendJson(res, 202, { id: job.id });
}

function handleLibrary(res: http.ServerResponse) {
  const items = fs.readdirSync(config.outputDir)
    .filter(f => /\.mp3$/i.test(f))
    .map(f => {
      const st = fs.statSync(path.join(config.outputDir, f));
      return { file: f, url: '/output/' + encodeURIComponent(f), sizeBytes: st.size, modified: st.mtimeMs };
    })
    .sort((a, b) => b.modified - a.modified);
  sendJson(res, 200, items);
}

function handleOutput(req: http.IncomingMessage, res: http.ServerResponse, name: string, download: boolean) {
  const file = path.basename(name);
  const full = path.join(config.outputDir, file);
  if (!/\.mp3$/i.test(file) || !fs.existsSync(full)) return sendJson(res, 404, { error: 'Not found' });
  const size = fs.statSync(full).size;
  const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${file.replace(/"/g, '')}"`;

  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && url.pathname === '/convert') return void handleConvert(req, res);
  if (req.method === 'GET' && url.pathname === '/library') return handleLibrary(res);
  if (req.method === 'GET' && url.pathname === '/jobs/active') return sendJson(res, 200, activeJob);
  if (req.method === 'GET' && url.pathname.startsWith('/jobs/')) {
    const job = jobs.get(url.pathname.slice('/jobs/'.length));
    return job ? sendJson(res, 200, job) : sendJson(res, 404, { error: 'Job not found' });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/output/')) {
    return handleOutput(req, res, decodeURIComponent(url.pathname.slice('/output/'.length)), url.searchParams.has('download'));
  }
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`PDF to Audiobook running at http://localhost:${PORT}`);
});
