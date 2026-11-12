// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { PDFExtractor } from './pdfExtractor';
import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import type { AudiobookConfig } from './types';

async function testRealPipeline() {
  console.log('🚀 REAL PIPELINE TEST: PDF → Extract → Filter → Summarize → Audio\n');

  try {
    const pdfPath = '/private/tmp/technical-book.pdf';

    console.log('STEP 1: Extract PDF\n');
    const extractor = new PDFExtractor();
    const extracted = await extractor.extractFromFile(pdfPath);
    
    let stats = { headers: 0, toc: 0, refs: 0, gloss: 0, tables: 0, figs: 0, body: 0 };
    for (const page of extracted.pages) {
      for (const el of page.elements) {
        if (el.type === 'header') stats.headers++;
        else if (el.type === 'toc') stats.toc++;
        else if (el.type === 'reference') stats.refs++;
        else if (el.type === 'glossary') stats.gloss++;
        else if (el.type === 'table') stats.tables++;
        else if (el.type === 'figure') stats.figs++;
        else if (el.type === 'body') stats.body++;
      }
    }

    console.log(`✓ Pages: ${extracted.pages.length}`);
    console.log(`✓ Elements found:`);
    console.log(`  - Headers: ${stats.headers}`);
    console.log(`  - TOC: ${stats.toc}`);
    console.log(`  - References: ${stats.refs}`);
    console.log(`  - Glossary: ${stats.gloss}`);
    console.log(`  - Tables: ${stats.tables}`);
    console.log(`  - Figures: ${stats.figs}`);
    console.log(`  - Body: ${stats.body}\n`);

    console.log('STEP 2: Clean Content\n');
    const cleaner = new ContentCleaner();
    const cleaned = await cleaner.clean(extracted);

    console.log(`✓ Filtered narrative: ${cleaned.narrativeText.length} chars`);
    console.log(`✓ Summaries generated: ${cleaned.summaries.length}`);
    
    if (cleaned.summaries.length > 0) {
      console.log('\nSummaries:');
      for (const s of cleaned.summaries) {
        console.log(`  - ${s.type.toUpperCase()} ${s.number}: ${s.summary}`);
      }
    }
    console.log();

    console.log('STEP 3: Text-to-Speech\n');
    const config: AudiobookConfig = {
      pdfPath,
      outputPath: path.join(process.cwd(), 'test-audiobook.wav'),
      voiceProvider: 'mac',
      voice: 'Samantha',
    };

    const converter = new TTSConverter(config);
    const audio = await converter.convertToAudio(cleaned.narrativeText, config);

    console.log(`✓ Audio: ${(audio.audio.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`✓ Duration: ${Math.floor(audio.duration / 60)}m ${Math.floor(audio.duration % 60)}s\n`);

    // Save
    const outDir = path.join(process.cwd(), 'test-pipeline-output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const audioPath = path.join(outDir, 'audiobook.wav');
    fs.writeFileSync(audioPath, audio.audio);

    console.log(`✅ Output: ${audioPath}\n`);
    console.log(`File: ${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(2)} MB\n`);

    return true;
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    return false;
  }
}

testRealPipeline().then(ok => process.exit(ok ? 0 : 1));
