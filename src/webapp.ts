import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { processPdf } from './processPdf';
import { getConfig } from './config';

const PORT = Number(process.env.PORT || 3000);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const VOICE = 'sarah';

if (!process.env.ELEVENLABS_API_KEY || !process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: ELEVENLABS_API_KEY and ANTHROPIC_API_KEY must be set (see .env)');
  process.exit(1);
}

const config = getConfig();
let busy = false;

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF to Audiobook</title>
<style>
:root { --bg:#fff; --fg:#1a1a1a; --muted:#666; --accent:#1f6feb; --line:#d0d7de; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --line:#30363d; } }
:root[data-theme="dark"] { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --line:#30363d; }
body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font-family:system-ui,sans-serif; }
main { max-width:560px; margin:0 auto; }
h1 { font-size:1.4rem; }
.box { border:1px solid var(--line); border-radius:8px; padding:16px; margin-top:12px; }
button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:10px 16px; font-size:1rem; cursor:pointer; }
button:disabled { opacity:.5; cursor:default; }
#status { margin-top:12px; color:var(--muted); white-space:pre-wrap; }
audio { width:100%; margin-top:12px; }
</style>
</head>
<body>
<main>
<h1>PDF to Audiobook</h1>
<div class="box">
<input type="file" id="pdf" accept="application/pdf">
<p><button id="go" disabled>Convert</button></p>
<div id="status"></div>
<div id="result"></div>
</div>
</main>
<script>
const pdf = document.getElementById('pdf');
const go = document.getElementById('go');
const status = document.getElementById('status');
const result = document.getElementById('result');
pdf.addEventListener('change', () => { go.disabled = !pdf.files.length; result.innerHTML = ''; });
go.addEventListener('click', async () => {
  const file = pdf.files[0];
  go.disabled = true;
  result.innerHTML = '';
  status.textContent = 'Converting ' + file.name + '. This takes about as long as the audio plays, plus processing. Keep this tab open.';
  try {
    const res = await fetch('/convert', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    status.textContent = 'Done: ' + data.sections + ' sections, ' + Math.round(data.durationSeconds / 60) + ' min.';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = data.url;
    const link = document.createElement('a');
    link.href = data.url;
    link.download = data.file;
    link.textContent = 'Download MP3';
    result.append(audio, document.createElement('p'), link);
  } catch (err) {
    status.textContent = 'Failed: ' + err.message;
  } finally {
    go.disabled = !pdf.files.length;
  }
});
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

async function handleConvert(req: http.IncomingMessage, res: http.ServerResponse) {
  if (busy) return sendJson(res, 409, { error: 'A conversion is already running. Wait for it to finish.' });

  const rawName = decodeURIComponent(String(req.headers['x-filename'] || ''));
  const baseName = path.basename(rawName).replace(/[^A-Za-z0-9._ -]/g, '_');
  if (!/\.pdf$/i.test(baseName)) return sendJson(res, 400, { error: 'Upload a .pdf file.' });

  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, 413, { error: err instanceof Error ? err.message : String(err) });
  }
  if (body.length < 5 || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return sendJson(res, 400, { error: 'File is not a PDF.' });
  }

  busy = true;
  try {
    const inputPath = path.join(config.inputDir, baseName);
    fs.writeFileSync(inputPath, body);
    const result = await processPdf(inputPath, config.outputDir, VOICE, msg => console.log(msg));
    sendJson(res, 200, {
      url: '/output/' + encodeURIComponent(path.basename(result.outputPath)),
      file: path.basename(result.outputPath),
      sections: result.sectionCount,
      durationSeconds: result.durationSeconds,
    });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  } finally {
    busy = false;
  }
}

function handleOutput(req: http.IncomingMessage, res: http.ServerResponse, name: string) {
  const file = path.basename(name);
  const full = path.join(config.outputDir, file);
  if (!fs.existsSync(full)) return sendJson(res, 404, { error: 'Not found' });
  const stat = fs.statSync(full);
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename="${file}"` });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && url.pathname === '/convert') {
    return void handleConvert(req, res);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/output/')) {
    return handleOutput(req, res, decodeURIComponent(url.pathname.slice('/output/'.length)));
  }
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`PDF to Audiobook running at http://localhost:${PORT}`);
});
