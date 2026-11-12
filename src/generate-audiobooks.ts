// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { PDFExtractor } from './pdfExtractor';
import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import type { AudiobookConfig } from './types';

async function generateAudiobooks() {
  const pdfs = [
    {
      path: '/private/tmp/technical-book.pdf',
      output: 'technical-book-alex.mp3',
      voice: 'Alex',
      title: 'Technical Book',
    },
    {
      path: '/Users/markvriesenga/Private/201-Agentic AI Projects/__Code-ArtfulChaos/Project-PDF2Audiobook/input/ArtfulChaos_Course_IntroductionForManagers_v2.0.pdf',
      output: 'ArtfulChaos_IntroductionForManagers_alex.mp3',
      voice: 'Alex',
      title: 'ArtfulChaos - Introduction for Managers',
    },
  ];

  console.log('🎙️  GENERATING HIGH-QUALITY NATURAL-SOUNDING AUDIOBOOKS\n');
  console.log('='  .repeat(70) + '\n');

  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  if (elevenLabsKey) {
    console.log('✓ Using ElevenLabs premium AI voices\n');
  } else {
    console.log('Voice: Alex (natural male speaker - more fluent than Victoria)\n');
  }

  for (const pdf of pdfs) {
    if (!fs.existsSync(pdf.path)) {
      console.log(`⚠️  Skipping ${pdf.title} (file not found)\n`);
      continue;
    }

    console.log(`Processing: ${pdf.title}`);
    console.log('-'.repeat(70));

    // Extract
    const extractor = new PDFExtractor();
    const extracted = await extractor.extractFromFile(pdf.path);

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

    // Clean
    const cleaner = new ContentCleaner();
    const cleaned = await cleaner.clean(extracted);

    // Convert
    const config: AudiobookConfig = {
      pdfPath: pdf.path,
      outputPath: path.join(process.cwd(), pdf.output),
      voiceProvider: elevenLabsKey ? 'elevenlabs' : 'mac',
      voice: pdf.voice,
      speed: 0.95,
    };

    const conv = new TTSConverter(config);
    console.log(`Voice: ${conv.getProviderName()}`);

    const audio = await conv.convertToAudio(cleaned.narrativeText, config);

    const outDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    
    const audioPath = path.join(outDir, pdf.output);
    fs.writeFileSync(audioPath, audio.audio);

    const stats = fs.statSync(audioPath);
    const durationMin = Math.floor(audio.duration / 60);
    const durationSec = Math.floor(audio.duration % 60);

    console.log(`Pages: ${extracted.pages.length} | Content: ${cleaned.narrativeText.length} chars`);
    console.log(`Output: ${(stats.size / 1024 / 1024).toFixed(2)} MB | Duration: ${durationMin}m ${durationSec}s`);
    console.log(`✓ Saved to: ${audioPath}\n`);
  }

  console.log('='  .repeat(70));
  console.log('\n✅ AUDIOBOOKS GENERATED\n');

  console.log('FOR TRULY NATURAL SPEECH:');
  console.log('  1. Sign up at https://elevenlabs.io (free tier: 10K chars/month)');
  console.log('  2. Get API key from Settings');
  console.log('  3. Set: export ELEVENLABS_API_KEY="your_key_here"');
  console.log('  4. Regenerate for professional AI voices (Rachel, Bella, etc.)\n');
}

generateAudiobooks()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
