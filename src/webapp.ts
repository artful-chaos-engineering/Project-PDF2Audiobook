// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { processPdf } from './processPdf';
import { getConfig } from './config';
import { AUDIENCES, MODES, parseMode, Mode, DEFAULT_VOICES, Presentation } from './modes';
import { VOICE_IDS, ElevenLabsTTS, ttsModel, voiceSettingsFor } from './ttsConverter';
import { DEFAULT_TUNING, TUNING_RANGES, readTunings, tuningOf, validateTuning, writeTuning } from './voiceSettings';
import { audioTagsEnabled } from './ttsConverter';
import { PREVIEW_CASES } from './previewCases';
import { readSettings, writeSettings, setEnvValue, MAX_TEXT_CHARS } from './settings';
import { currentRules, parseRulesText, rulesToText, saveRules } from './pronunciation';

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
.tabs { display:flex; gap:8px; margin-top:12px; }
.tab { padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--muted); font:inherit; cursor:pointer; }
.tab.active { color:var(--fg); border-color:var(--accent); font-weight:600; }
.slider { margin-top:14px; }
.slider label { margin:0 0 4px; }
.slider input[type=range] { width:100%; accent-color:var(--accent); }
.slider .hint { margin-top:2px; }
.tv { color:var(--accent); font-weight:600; margin-left:6px; }
.check { display:flex; align-items:center; gap:8px; margin-top:14px; font-weight:400; }
.check input { width:auto; }
select, textarea, input[type=number] { width:100%; padding:8px; border-radius:6px; border:1px solid var(--line); background:var(--card); color:var(--fg); font:inherit; }
textarea { resize:vertical; }
.row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
@media (max-width: 520px) { .row2 { grid-template-columns:1fr; } }
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

<nav class="tabs" aria-label="Sections">
<button class="tab active" id="tabConvert" type="button">Convert</button>
<button class="tab" id="tabTune" type="button">Voice tuning</button>
<button class="tab" id="tabPron" type="button">Pronunciation</button>
</nav>

<div id="messages" aria-live="polite"></div>

<div id="convertTab">

<section class="card" id="form">
<h2>New conversion</h2>
<div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose a PDF">
<div id="dropText">Drop a PDF here or click to choose (max 50 MB)</div>
</div>
<input type="file" id="pdf" accept="application/pdf" hidden>
<label for="mode">Mode</label>
<select id="mode">${modeOptions()}</select>
<div class="hint" id="modeDesc"></div>
<div class="row2">
<div><label for="speaker1">Speaker 1</label><select id="speaker1">${voiceOptions(DEFAULT_VOICES.speaker1)}</select></div>
<div><label for="speaker2">Speaker 2</label><select id="speaker2">${voiceOptions(DEFAULT_VOICES.speaker2)}</select></div>
</div>
<label for="intro">Introduction (read at the start of the audiobook)</label>
<textarea id="intro" rows="4" placeholder="Leave empty for no introduction"></textarea>
<label for="outro">Outroduction (read at the end of the audiobook)</label>
<textarea id="outro" rows="4" placeholder="Leave empty for no outroduction"></textarea>
<div class="actions"><button class="ghost" id="saveText">Save introduction and outroduction for this mode</button></div>
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
</div>

<section class="card" id="tuneTab" hidden>
<h2>Voice tuning</h2>
<label for="tuneVoice">Voice</label>
<select id="tuneVoice">${voiceOptions('matilda')}</select>
<p class="hint" id="tuneNote"></p>

<div class="slider"><label for="t-stability">Stability <span class="tv" id="tv-stability"></span></label>
<input type="range" id="t-stability" min="0" max="1" step="0.01">
<p class="hint">Low gives more expression and variation between takes. High gives a steadier, flatter read.</p></div>

<div class="slider"><label for="t-similarity">Similarity <span class="tv" id="tv-similarity"></span></label>
<input type="range" id="t-similarity" min="0" max="1" step="0.01">
<p class="hint">How closely the output follows the voice itself. High sounds more like the source; very high can add noise on weak recordings.</p></div>

<div class="slider" id="styleRow"><label for="t-style">Style <span class="tv" id="tv-style"></span></label>
<input type="range" id="t-style" min="0" max="1" step="0.01">
<p class="hint">Exaggeration of the speaking style. Adds delay and can make the voice less stable.</p></div>

<div class="slider" id="speedRow"><label for="t-speed">Speed <span class="tv" id="tv-speed"></span></label>
<input type="range" id="t-speed" min="0.7" max="1.2" step="0.01">
<p class="hint">Speaking rate. 1.00 is the voice's natural pace. Values far from 1.00 can lower quality.</p></div>

<div class="slider"><label for="t-trim">Level trim <span class="tv" id="tv-trim"></span> dB</label>
<input type="range" id="t-trim" min="-6" max="6" step="0.5">
<p class="hint">Adds or removes loudness for this voice after the two voices are levelled. Capped so it never clips.</p></div>

<div class="slider"><label for="t-pause">Pause length <span class="tv" id="tv-pause"></span>×</label>
<input type="range" id="t-pause" min="0.5" max="2" step="0.05">
<p class="hint">Scales the pauses that follow this voice's speech. Above 1 gives more room; below 1 speeds the conversation up.</p></div>

<div class="slider" id="cloneRow"><label for="t-clone">Clone strength <span class="tv" id="tv-clone"></span></label>
<input type="range" id="t-clone" min="0" max="1" step="0.01">
<p class="hint">How closely a professional clone is applied. ElevenLabs recommends 0 for most uses and 0.5 if the clone sounds wrong. Only for eleven_v4.</p></div>

<label for="t-norm">Text normalization</label>
<select id="t-norm"><option value="auto">Auto: the system decides</option><option value="on">On: always spell out numbers and abbreviations</option><option value="off">Off: read the text as written</option></select>

<label for="t-seed">Seed</label>
<input type="number" id="t-seed" min="0" max="4294967295" placeholder="Empty = random">
<p class="hint">The same seed and settings give the same result, as far as the service can manage. Empty means a new random result each time.</p>

<label class="check"><input type="checkbox" id="tuneBoost"> Speaker boost (sharper match to the voice)</label>

<label class="check"><input type="checkbox" id="audioTags"> Delivery tags in scripts ([laughs], [sighs], [whispers]). eleven_v4 only; applies to all voices.</label>

<label for="previewCase">Test case</label>
<select id="previewCase">${PREVIEW_CASES.map((c, i) => `<option value="${i}">${i + 1}. ${c.name}</option>`).join('')}</select>
<label for="previewText">Preview text</label>
<textarea id="previewText" rows="6" maxlength="1000"></textarea>

<div class="actions">
<button class="ghost" id="tunePreview" type="button">Preview</button>
<button class="primary" id="tuneSave" type="button">Save for this voice</button>
<button class="ghost" id="tuneReset" type="button">Reset to default</button>
</div>
<audio id="tuneAudio" controls hidden style="width:100%;margin-top:12px"></audio>
</section>

<section class="card" id="pronTab" hidden>
<h2>Pronunciation</h2>
<p class="hint">One rule per line, written as <code>word = how it is said</code>. For example <code>SysML = sis em el</code>. Rules apply to every voice and every conversion. Saving sends them to ElevenLabs.</p>
<textarea id="pronText" rows="10" placeholder="SysML = sis em el"></textarea>
<div class="actions"><button class="primary" id="pronSave" type="button">Save pronunciations</button></div>
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

function loadSettings() {
  fetch('/settings?mode=' + encodeURIComponent(mode.value))
    .then(r => r.json())
    .then(d => { $('intro').value = d.intro; $('outro').value = d.outro; })
    .catch(() => showMessage('error', 'Could not load the introduction and outroduction.'));
}
async function saveSettings() {
  try {
    const res = await fetch('/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode.value, intro: $('intro').value, outro: $('outro').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showMessage('info', 'Saved the introduction and outroduction for ' + mode.value + '.');
  } catch (err) {
    showMessage('error', 'Save failed: ' + err.message);
  }
}
function updateDesc() { $('modeDesc').textContent = mode.selectedOptions[0]?.dataset.desc || ''; }
mode.onchange = () => { updateDesc(); loadSettings(); try { localStorage.setItem('mode', mode.value); } catch {} };
try { const m = localStorage.getItem('mode'); if (m && [...mode.options].some(o => o.value === m)) mode.value = m; } catch {}
updateDesc();
loadSettings();

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
  if (job.step === 3 && job.sectionsTotal) pct = 50 + 25 * job.sectionsDone / job.sectionsTotal;
  $('bar').value = pct;
  const label = job.step === 2 ? 'Section ' : job.step === 3 ? 'Script section ' : '';
  $('stepInfo').textContent = label && job.sectionsTotal ? label + job.sectionsDone + ' of ' + job.sectionsTotal : job.status === 'running' ? 'Step ' + job.step + ' of 4' : '';
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
    const res = await fetch('/convert', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'X-Mode': mode.value, 'X-Speaker1': $('speaker1').value, 'X-Speaker2': $('speaker2').value }, body: file });
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
$('saveText').onclick = saveSettings;

const TUNE_FIELDS = { stability: 't-stability', similarity_boost: 't-similarity', style: 't-style', speed: 't-speed', trim_db: 't-trim', pause_scale: 't-pause', clone_strength: 't-clone' };
const TUNE_READOUTS = { stability: 'tv-stability', similarity_boost: 'tv-similarity', style: 'tv-style', speed: 'tv-speed', trim_db: 'tv-trim', pause_scale: 'tv-pause', clone_strength: 'tv-clone' };
let tuneDefaults = null;
let pronLoaded = false;

function showTab(name) {
  $('convertTab').hidden = name !== 'convert';
  $('tuneTab').hidden = name !== 'tune';
  $('pronTab').hidden = name !== 'pron';
  $('tabConvert').classList.toggle('active', name === 'convert');
  $('tabTune').classList.toggle('active', name === 'tune');
  $('tabPron').classList.toggle('active', name === 'pron');
  if (name === 'tune') { loadTuning(); loadGlobal(); }
  if (name === 'pron' && !pronLoaded) loadPronunciations();
}
$('tabConvert').onclick = () => showTab('convert');
$('tabTune').onclick = () => showTab('tune');
$('tabPron').onclick = () => showTab('pron');

function readTuneForm() {
  const tuning = {};
  for (const key of Object.keys(TUNE_FIELDS)) tuning[key] = Number($(TUNE_FIELDS[key]).value);
  tuning.use_speaker_boost = $('tuneBoost').checked;
  tuning.text_normalization = $('t-norm').value;
  const seed = $('t-seed').value.trim();
  tuning.seed = seed === '' ? null : Number(seed);
  return tuning;
}

function fillTuneForm(tuning) {
  for (const key of Object.keys(TUNE_FIELDS)) {
    $(TUNE_FIELDS[key]).value = tuning[key];
    $(TUNE_READOUTS[key]).textContent = Number(tuning[key]).toFixed(2);
  }
  $('tuneBoost').checked = !!tuning.use_speaker_boost;
  $('t-norm').value = tuning.text_normalization || 'auto';
  $('t-seed').value = tuning.seed === null || tuning.seed === undefined ? '' : tuning.seed;
}

function applyModelLimits(d) {
  const speedStyle = d.supportsSpeedAndStyle;
  for (const key of ['style', 'speed']) $(TUNE_FIELDS[key]).disabled = !speedStyle;
  $('styleRow').style.opacity = speedStyle ? '1' : '.5';
  $('speedRow').style.opacity = speedStyle ? '1' : '.5';
  $('t-clone').disabled = !d.supportsCloneStrength;
  $('cloneRow').style.opacity = d.supportsCloneStrength ? '1' : '.5';
  $('tuneNote').textContent = 'Model ' + d.model + '. '
    + (speedStyle ? 'All sliders apply to single-voice speech.' : 'No speed or style control on this model, so those two sliders are off.')
    + (d.supportsCloneStrength ? '' : ' Clone strength applies only to eleven_v4.');
}

function loadTuning() {
  const voice = $('tuneVoice').value;
  fetch('/voice-settings?voice=' + encodeURIComponent(voice))
    .then(r => r.json())
    .then(d => {
      if (d.error) throw new Error(d.error);
      tuneDefaults = d.defaults;
      fillTuneForm(d.tuning);
      applyModelLimits(d);
    })
    .catch(err => showMessage('error', 'Could not load the voice settings: ' + err.message));
}

function loadGlobal() {
  fetch('/global')
    .then(r => r.json())
    .then(d => { $('audioTags').checked = d.audioTags === 'on'; })
    .catch(() => showMessage('error', 'Could not load the delivery-tag setting.'));
}

async function saveGlobal() {
  try {
    const res = await fetch('/global', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioTags: $('audioTags').checked ? 'on' : 'off' }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showMessage('info', 'Delivery tags are ' + data.audioTags + '. New scripts follow this setting.');
  } catch (err) {
    showMessage('error', 'Save failed: ' + err.message);
  }
}

async function saveTuning() {
  try {
    const res = await fetch('/voice-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: $('tuneVoice').value, tuning: readTuneForm() }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    showMessage('info', 'Saved the settings for ' + $('tuneVoice').value + '. New conversions use them.');
  } catch (err) {
    showMessage('error', 'Save failed: ' + err.message);
  }
}

async function previewTuning() {
  const button = $('tunePreview');
  button.disabled = true;
  try {
    const res = await fetch('/voice-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: $('tuneVoice').value, tuning: readTuneForm(), text: $('previewText').value }) });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || res.statusText);
    }
    const audio = $('tuneAudio');
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(await res.blob());
    audio.hidden = false;
    audio.play().catch(() => {});
  } catch (err) {
    showMessage('error', 'Preview failed: ' + err.message);
  } finally {
    button.disabled = false;
  }
}

function loadPronunciations() {
  fetch('/pronunciations')
    .then(r => r.json())
    .then(d => { $('pronText').value = d.text; pronLoaded = true; })
    .catch(err => showMessage('error', 'Could not load the pronunciations: ' + err.message));
}

async function savePronunciations() {
  const button = $('pronSave');
  button.disabled = true;
  try {
    const res = await fetch('/pronunciations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: $('pronText').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    $('pronText').value = data.text;
    showMessage('info', data.version_id ? 'Saved the pronunciations to ElevenLabs. They apply to the next conversion.' : 'Cleared the pronunciations.');
  } catch (err) {
    showMessage('error', 'Save failed: ' + err.message);
  } finally {
    button.disabled = false;
  }
}

const PREVIEW_TEXTS = ${JSON.stringify(PREVIEW_CASES.map(c => c.text))};
$('previewCase').onchange = () => { $('previewText').value = PREVIEW_TEXTS[Number($('previewCase').value)]; };
$('previewCase').value = '1';
$('previewText').value = PREVIEW_TEXTS[1];
$('tuneVoice').onchange = loadTuning;
$('tuneSave').onclick = saveTuning;
$('tunePreview').onclick = previewTuning;
$('tuneReset').onclick = () => { if (tuneDefaults) fillTuneForm(tuneDefaults); };
$('audioTags').onchange = saveGlobal;
$('pronSave').onclick = savePronunciations;
for (const key of Object.keys(TUNE_FIELDS)) {
  $(TUNE_FIELDS[key]).addEventListener('input', () => { $(TUNE_READOUTS[key]).textContent = Number($(TUNE_FIELDS[key]).value).toFixed(2); });
}

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
  if (step) { job.step = Number(step[1]); job.sectionsDone = 0; }
  const total = msg.match(/of (\d+) sections/);
  if (total) job.sectionsTotal = Number(total[1]);
  const sec = msg.match(/Section (\d+)\/(\d+)/);
  if (sec) { job.sectionsDone = Number(sec[1]); job.sectionsTotal = Number(sec[2]); }
  const script = msg.match(/Script (\d+)\/(\d+)/);
  if (script) { job.sectionsDone = Number(script[1]); job.sectionsTotal = Number(script[2]); }
}

async function runJob(job: Job, inputPath: string, presentation: Presentation) {
  try {
    const result = await processPdf(inputPath, config.outputDir, job.mode, msg => trackProgress(job, msg), presentation);
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

function voiceLabel(id: string): string {
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function voiceOptions(selected: string): string {
  return Object.keys(VOICE_IDS)
    .map(v => `<option value="${v}"${v === selected ? ' selected' : ''}>${voiceLabel(v)}</option>`)
    .join('');
}

function handleSettingsGet(url: URL, res: http.ServerResponse) {
  let mode: Mode;
  try {
    mode = parseMode(url.searchParams.get('mode') || '');
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
  sendJson(res, 200, readSettings(mode));
}

async function handleSettingsPost(req: http.IncomingMessage, res: http.ServerResponse) {
  let body: Buffer;
  try {
    body = await readBody(req);
  } catch (err) {
    return sendJson(res, 413, { error: err instanceof Error ? err.message : String(err) });
  }
  let data: { mode?: unknown; intro?: unknown; outro?: unknown };
  try {
    data = JSON.parse(body.toString('utf-8'));
  } catch {
    return sendJson(res, 400, { error: 'Send the settings as JSON.' });
  }
  let mode: Mode;
  try {
    mode = parseMode(String(data.mode || ''));
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
  if (typeof data.intro !== 'string' || typeof data.outro !== 'string') {
    return sendJson(res, 400, { error: 'Introduction and outroduction must be text.' });
  }
  if (data.intro.length > MAX_TEXT_CHARS || data.outro.length > MAX_TEXT_CHARS) {
    return sendJson(res, 400, { error: `Keep each text under ${MAX_TEXT_CHARS} characters.` });
  }
  writeSettings(mode, data.intro, data.outro);
  sendJson(res, 200, readSettings(mode));
}

const MAX_PREVIEW_CHARS = 1000;
const DEFAULT_PREVIEW = 'This is how I will sound when I read your audiobook. I keep a steady pace through the main ideas, pause at the end of each section, and slow down for numbers and names. Listen for warmth, clarity, and whether the voice still sounds natural over a longer passage, not only in one short sentence.';

function voiceNameFrom(value: unknown): string {
  const name = String(value || '').toLowerCase();
  if (!VOICE_IDS[name]) throw new Error(`Unknown voice "${value}".`);
  return name;
}

function supportsSpeedAndStyle(): boolean {
  return Object.keys(voiceSettingsFor(ttsModel(), DEFAULT_TUNING)).includes('speed');
}

function handleVoiceSettingsGet(url: URL, res: http.ServerResponse) {
  let voice: string;
  try {
    voice = voiceNameFrom(url.searchParams.get('voice'));
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
  try {
    sendJson(res, 200, {
      voice,
      tuning: tuningOf(voice, readTunings()),
      defaults: DEFAULT_TUNING,
      ranges: TUNING_RANGES,
      model: ttsModel(),
      supportsSpeedAndStyle: supportsSpeedAndStyle(),
      supportsCloneStrength: ttsModel() === 'eleven_v4',
    });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req);
  try {
    return JSON.parse(body.toString('utf-8'));
  } catch {
    throw new Error('Send the request as JSON.');
  }
}

async function handleVoiceSettingsPost(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await readJson(req);
    const voice = voiceNameFrom(data.voice);
    const tuning = validateTuning(data.tuning);
    writeTuning(voice, tuning);
    sendJson(res, 200, { voice, tuning });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleVoicePreview(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await readJson(req);
    const voice = voiceNameFrom(data.voice);
    const tuning = validateTuning(data.tuning);
    const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : DEFAULT_PREVIEW;
    if (text.length > MAX_PREVIEW_CHARS) throw new Error(`Keep the preview under ${MAX_PREVIEW_CHARS} characters.`);
    const audio = await new ElevenLabsTTS().synthesize(text, { pdfPath: '', outputPath: '', voiceProvider: 'elevenlabs', voice }, { tuning });
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length });
    res.end(audio);
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

function handlePronunciationGet(res: http.ServerResponse) {
  sendJson(res, 200, { text: rulesToText(currentRules()) });
}

async function handlePronunciationPost(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await readJson(req);
    if (typeof data.text !== 'string') throw new Error('Send the rules as text.');
    const rules = parseRulesText(data.text);
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set.');
    const locator = await saveRules(rules, apiKey);
    sendJson(res, 200, { text: rulesToText(rules), version_id: locator?.version_id ?? null });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

function handleGlobalGet(res: http.ServerResponse) {
  sendJson(res, 200, { audioTags: audioTagsEnabled() ? 'on' : 'off', model: ttsModel() });
}

async function handleGlobalPost(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const data = await readJson(req);
    if (data.audioTags !== 'on' && data.audioTags !== 'off') throw new Error('audioTags must be on or off.');
    setEnvValue('AUDIO_TAGS', data.audioTags);
    process.env.AUDIO_TAGS = data.audioTags;
    sendJson(res, 200, { audioTags: data.audioTags });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
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

  const speaker1 = String(req.headers['x-speaker1'] || DEFAULT_VOICES.speaker1);
  const speaker2 = String(req.headers['x-speaker2'] || DEFAULT_VOICES.speaker2);
  if (!VOICE_IDS[speaker1] || !VOICE_IDS[speaker2]) return sendJson(res, 400, { error: 'Choose a voice for Speaker 1 and Speaker 2.' });

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
  const texts = readSettings(mode);
  const presentation: Presentation = { voices: { speaker1, speaker2 }, intro: texts.intro, outro: texts.outro };
  const job: Job = {
    id: randomUUID(), file: baseName, mode, status: 'running', step: 0,
    sectionsDone: 0, sectionsTotal: 0, log: [], startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  activeJob = job;
  void runJob(job, inputPath, presentation);
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
  if (req.method === 'GET' && url.pathname === '/settings') return handleSettingsGet(url, res);
  if (req.method === 'GET' && url.pathname === '/voice-settings') return handleVoiceSettingsGet(url, res);
  if (req.method === 'POST' && url.pathname === '/voice-settings') return void handleVoiceSettingsPost(req, res);
  if (req.method === 'POST' && url.pathname === '/voice-preview') return void handleVoicePreview(req, res);
  if (req.method === 'GET' && url.pathname === '/pronunciations') return handlePronunciationGet(res);
  if (req.method === 'POST' && url.pathname === '/pronunciations') return void handlePronunciationPost(req, res);
  if (req.method === 'GET' && url.pathname === '/global') return handleGlobalGet(res);
  if (req.method === 'POST' && url.pathname === '/global') return void handleGlobalPost(req, res);
  if (req.method === 'POST' && url.pathname === '/settings') return void handleSettingsPost(req, res);
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
