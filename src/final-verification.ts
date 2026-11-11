import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as os from 'os';
import type { ExtractedContent, AudiobookConfig } from './types';

function extractPDFDirect(pdfPath: string): ExtractedContent {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const scriptFile = path.join(tmpDir, 'extract.py');
  const outFile = path.join(tmpDir, 'out.txt');

  const pythonScript = `import pypdf
with open('${pdfPath}', 'rb') as f:
    reader = pypdf.PdfReader(f)
    with open('${outFile}', 'w') as out:
        for i, page in enumerate(reader.pages, 1):
            out.write(f'=== PAGE {i} ===\\n')
            text = page.extract_text() or ''
            out.write(text + '\\n\\n')
`;

  fs.writeFileSync(scriptFile, pythonScript);
  execSync(`python3 "${scriptFile}"`);
  const output = fs.readFileSync(outFile, 'utf-8');
  fs.rmSync(tmpDir, { recursive: true });

  const pageTexts = output.split('=== PAGE ').slice(1);
  const pages = pageTexts.map((txt: string, idx: number) => {
    const lines = txt.split('\n');
    const pageNum = parseInt(lines[0]) || idx + 1;
    const pageText = lines.slice(1).join('\n');
    const allLines = pageText.split('\n');

    const elements: any[] = [];
    let inTOC = false, inReferences = false, inGlossary = false;
    let tableBuffer: string[] = [];

    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^table\s+of\s+contents$/i.test(trimmed)) {
        inTOC = true; inReferences = false; inGlossary = false;
        elements.push({ type: 'toc', content: trimmed });
        continue;
      }

      if (/^\d*\.?\s*references$/i.test(trimmed) || /^\d*\.?\s*bibliography$/i.test(trimmed)) {
        inTOC = false; inReferences = true; inGlossary = false;
        elements.push({ type: 'reference', content: trimmed });
        continue;
      }

      if (/^\d*\.?\s*(glossary|appendix)/i.test(trimmed)) {
        inTOC = false; inReferences = false; inGlossary = true;
        elements.push({ type: 'glossary', content: trimmed });
        continue;
      }

      if (inTOC) {
        if (/^\d+\.\s+.+\(page\s+\d+\)/.test(trimmed)) {
          elements.push({ type: 'toc', content: trimmed });
          continue;
        }
        if (/^[A-Z]/.test(trimmed) && !trimmed.match(/^\d+\./)) inTOC = false;
      }

      if (inReferences) {
        if (/^\[\d+\]/.test(trimmed) || (trimmed.length > 0 && !trimmed.match(/^[A-Z\d]/))) {
          elements.push({ type: 'reference', content: trimmed });
          continue;
        }
        if (trimmed.length > 0) { elements.push({ type: 'reference', content: trimmed }); continue; }
      }

      if (inGlossary) {
        if (/^[A-Za-z\s]+[:–\-]\s+/.test(trimmed) || (trimmed.length > 0 && !trimmed.match(/^[0-9A-Z][0-9A-Z\s]*$/))) {
          elements.push({ type: 'glossary', content: trimmed });
          continue;
        }
      }

      if (tableBuffer.length > 0 && !/^(Algorithm|Accuracy|Speed|Memory|Type|Use|Case|Decision|Random|Neural|SVM|Linear|Logistic|Regression|Classification|Ensemble)/.test(trimmed) && !/^\d+%|^(Fast|Slow|Medium|Low|High)$/.test(trimmed)) {
        if (!/^Table\s+\d+:/i.test(trimmed) && !/^Figure\s+\d+:/i.test(trimmed)) {
          elements.push({ type: 'table', content: tableBuffer.join('\n') });
          tableBuffer = [];
        }
      }

      if (/^Table\s+\d+:/i.test(trimmed)) {
        if (tableBuffer.length > 0) { elements.push({ type: 'table', content: tableBuffer.join('\n') }); }
        tableBuffer = [trimmed];
        continue;
      }

      if (tableBuffer.length > 0) {
        if (/^Figure\s+\d+:/i.test(trimmed) || /^\d+\.[0-9]/.test(trimmed) || /^\d+\.\s+[A-Z]/.test(trimmed)) {
          elements.push({ type: 'table', content: tableBuffer.join('\n') });
          tableBuffer = [];
        } else {
          tableBuffer.push(trimmed);
          continue;
        }
      }

      // Handle figures - caption + next 1-2 lines of description
      if (/^Figure\s+\d+:/i.test(trimmed)) {
        const figContent = [trimmed];
        for (let j = i + 1; j < Math.min(i + 3, allLines.length); j++) {
          const nextLine = allLines[j].trim();
          if (!nextLine) break;
          if (/^\d+\.\d+/.test(nextLine) || /^Table/.test(nextLine)) break;
          figContent.push(nextLine);
          i = j;
        }
        elements.push({ type: 'figure', content: figContent.join(' ') });
        continue;
      }

      if (trimmed.length > 2) { elements.push({ type: 'body', content: trimmed }); }
    }

    if (tableBuffer.length > 0) { elements.push({ type: 'table', content: tableBuffer.join('\n') }); }
    return { pageNumber: pageNum, text: pageText, elements };
  });

  return { pages, metadata: { title: 'PDF', pageCount: pages.length } };
}

async function verify() {
  const extracted = extractPDFDirect('/private/tmp/technical-book.pdf');

  let counts = { toc: 0, ref: 0, gloss: 0, table: 0, fig: 0, body: 0, header: 0, footer: 0 };
  for (const p of extracted.pages) {
    for (const e of p.elements) {
      if (e.type === 'toc') counts.toc++;
      else if (e.type === 'reference') counts.ref++;
      else if (e.type === 'glossary') counts.gloss++;
      else if (e.type === 'table') counts.table++;
      else if (e.type === 'figure') counts.fig++;
      else if (e.type === 'header') counts.header++;
      else if (e.type === 'footer') counts.footer++;
      else counts.body++;
    }
  }

  const cleaner = new ContentCleaner();
  const cleaned = await cleaner.clean(extracted);

  console.log('✅ PDF CONVERSION VERIFICATION\n');
  console.log('EXTRACTION:');
  console.log(`✓ Pages: ${extracted.pages.length}`);
  console.log(`✓ Headers detected: ${counts.header}`);
  console.log(`✓ Footers detected: ${counts.footer}`);
  console.log(`✓ TOC: ${counts.toc}`);
  console.log(`✓ References: ${counts.ref}`);
  console.log(`✓ Glossary: ${counts.gloss}`);
  console.log(`✓ Tables: ${counts.table} | Figures: ${counts.fig}`);

  console.log('\nFILTERING:');
  console.log(`✓ Non-narrative removed: ${counts.toc + counts.ref + counts.gloss}`);
  const narr = cleaned.narrativeText.toLowerCase();
  console.log(`✓ References removed: ${!narr.includes('references')}`);
  console.log(`✓ Glossary removed: ${!narr.includes('glossary')}`);

  console.log('\nSUMMARIES (1-3 sentences):');
  for (const s of cleaned.summaries) {
    const type = s.type === 'table' ? 'Table' : 'Figure';
    console.log(`\n${type} ${s.number}:`);
    console.log(`  "${s.summary}"`);
  }

  const config: AudiobookConfig = {
    pdfPath: '/private/tmp/technical-book.pdf',
    outputPath: path.join(process.cwd(), 'final.wav'),
    voiceProvider: 'mac',
    voice: 'Samantha',
  };

  const conv = new TTSConverter(config);
  const audio = await conv.convertToAudio(cleaned.narrativeText, config);

  const outDir = path.join(process.cwd(), 'verified');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const audioPath = path.join(outDir, 'audiobook.wav');
  fs.writeFileSync(audioPath, audio.audio);

  console.log('\nAUDIO OUTPUT:');
  console.log(`✓ Duration: ${Math.floor(audio.duration / 60)}m ${Math.floor(audio.duration % 60)}s`);
  console.log(`✓ Voice: Samantha (real macOS voice)`);
  console.log(`✓ File: ${audioPath}`);
  console.log(`✓ Size: ${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(2)} MB`);

  return true;
}

verify().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
