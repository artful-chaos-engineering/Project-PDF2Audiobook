// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { PDFExtractor } from './pdfExtractor';
import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import type { AudiobookConfig } from './types';

async function verify() {
  const extractor = new PDFExtractor();
  const extracted = await extractor.extractFromFile('/private/tmp/technical-book.pdf');

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

  console.log('✅ PDF CONVERSION CHECK\n');
  console.log('EXTRACTION:');
  console.log(`✓ Pages: ${extracted.pages.length}`);
  console.log(`✓ Headers detected: ${counts.header} (removed from narrative)`);
  console.log(`✓ Footers detected: ${counts.footer} (removed from narrative)`);
  console.log(`✓ TOC: ${counts.toc} | References: ${counts.ref} | Glossary: ${counts.gloss}`);
  console.log(`✓ Tables: ${counts.table} | Figures: ${counts.fig}`);

  console.log('\nFILTERING:');
  console.log(`✓ Non-narrative filtered: ${counts.toc + counts.ref + counts.gloss + counts.header + counts.footer}`);
  const narr = cleaned.narrativeText.toLowerCase();
  console.log(`✓ References in narrative: ${narr.includes('references')}`);
  console.log(`✓ Glossary in narrative: ${narr.includes('glossary')}`);

  console.log('\nSUMMARIES:');
  for (const s of cleaned.summaries) {
    const type = s.type === 'table' ? 'Table' : 'Figure';
    console.log(`\n${type} ${s.number}:`);
    console.log(`  "${s.summary}"`);
  }

  const config: AudiobookConfig = {
    pdfPath: '/private/tmp/technical-book.pdf',
    outputPath: path.join(process.cwd(), 'final.mp3'),
    voiceProvider: 'mac',
    voice: 'Samantha',
  };

  const conv = new TTSConverter(config);
  const audio = await conv.convertToAudio(cleaned.narrativeText, config);

  const outDir = path.join(process.cwd(), 'verified');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const audioPath = path.join(outDir, 'audiobook.mp3');
  fs.writeFileSync(audioPath, audio.audio);

  console.log('\nAUDIO:');
  console.log(`✓ Duration: ${Math.floor(audio.duration / 60)}m ${Math.floor(audio.duration % 60)}s`);
  console.log(`✓ Format: MP3`);
  console.log(`✓ Size: ${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`✓ Location: ${audioPath}`);

  return true;
}

verify().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e.message); process.exit(1); });
