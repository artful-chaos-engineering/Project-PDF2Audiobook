// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { processPdf } from './processPdf';
import { getConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';
import { parseMode, DEFAULT_VOICES } from './modes';
import { readSettings } from './settings';

async function generateWithElevenLabs() {
  const config = getConfig();

  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('❌ ELEVENLABS_API_KEY not set');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const inputFiles = fs.readdirSync(config.inputDir).filter(f => f.endsWith('.pdf'));

  if (inputFiles.length === 0) {
    console.log(`❌ No PDFs in: ${config.inputDir}`);
    process.exit(1);
  }

  console.log('🎙️  INTELLIGENT AUDIOBOOK GENERATION\n');
  console.log('='  .repeat(70) + '\n');
  console.log(`Input: ${config.inputDir}`);
  console.log(`Output: ${config.outputDir}\n`);

  const mode = parseMode(process.argv[2] || process.env.AUDIOBOOK_MODE);
  console.log(`Mode: ${mode}\n`);

  let failures = 0;
  for (const file of inputFiles) {
    console.log(`Processing: ${file}`);
    console.log('-'.repeat(70));
    try {
      const texts = readSettings(mode);
      const presentation = { voices: DEFAULT_VOICES, intro: texts.intro, outro: texts.outro };
      const result = await processPdf(path.join(config.inputDir, file), config.outputDir, mode, console.log, presentation);
      const mins = Math.floor(result.durationSeconds / 60);
      const secs = Math.floor(result.durationSeconds % 60);
      console.log(`✓ Generated: ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB | ${mins}m ${secs}s\n`);
    } catch (error) {
      failures++;
      console.error(`✗ Failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log('='  .repeat(70));
  if (failures > 0) {
    throw new Error(`${failures} of ${inputFiles.length} file(s) failed`);
  }
  console.log('\n✅ AUDIOBOOK GENERATION COMPLETE\n');
}

generateWithElevenLabs()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
