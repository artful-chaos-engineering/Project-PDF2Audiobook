import { processPdf } from './processPdf';
import { getConfig } from './config';
import * as fs from 'fs';
import * as path from 'path';

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

  const voices = ['sarah', 'bella', 'laura', 'charlie', 'george'];
  let voiceIndex = 0;

  let failures = 0;
  for (const file of inputFiles) {
    const voice = voices[voiceIndex % voices.length];
    voiceIndex++;

    console.log(`Processing: ${file}`);
    console.log('-'.repeat(70));
    try {
      const result = await processPdf(path.join(config.inputDir, file), config.outputDir, voice);
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
