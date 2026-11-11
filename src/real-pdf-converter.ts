import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import type { AudiobookConfig } from './types';

async function convertRealPDF() {
  console.log('📖 REAL PDF TO AUDIOBOOK CONVERSION\n');

  try {
    // Read extracted PDF text
    const extractedPath = '/private/tmp/extracted-text.txt';
    let fullText = fs.readFileSync(extractedPath, 'utf-8');

    console.log('INPUT: Real PDF text extracted\n');

    // Simple filtering: remove TOC, references, glossary, tables
    const lines = fullText.split('\n');
    const narrative: string[] = [];
    const removed = {
      toc: 0, references: 0, glossary: 0, tables: 0, headers: 0
    };

    let skipSection = false;

    for (const line of lines) {
      const lower = line.toLowerCase();

      if (lower.includes('table of contents') || lower.includes('references') || lower.includes('glossary')) {
        skipSection = true;
        removed[lower.includes('table of contents') ? 'toc' : lower.includes('references') ? 'references' : 'glossary']++;
        continue;
      }

      if (skipSection) {
        if (line.startsWith('=== PAGE')) skipSection = false;
        else continue;
      }

      if (/Table \d+:/.test(line)) {
        removed.tables++;
        narrative.push(`[Table removed - see PDF for details]`);
        continue;
      }

      if (/Figure \d+:/.test(line)) {
        narrative.push(`[Figure removed - see PDF for details]`);
        continue;
      }

      if (line.trim()) narrative.push(line);
    }

    const cleaned = narrative.join('\n');
    console.log(`FILTERING RESULTS:\n`);
    console.log(`✓ TOC removed: ${removed.toc}`);
    console.log(`✓ References removed: ${removed.references}`);
    console.log(`✓ Glossary removed: ${removed.glossary}`);
    console.log(`✓ Tables filtered: ${removed.tables}\n`);
    console.log(`✓ Narrative text: ${cleaned.length} chars\n`);

    // Generate audio
    console.log('TEXT-TO-SPEECH:\n');
    const config: AudiobookConfig = {
      pdfPath: extractedPath,
      outputPath: path.join(process.cwd(), 'real-pdf-audiobook.wav'),
      voiceProvider: 'mac',
      voice: 'Alex',
    };

    const converter = new TTSConverter(config);
    const audio = await converter.convertToAudio(cleaned, config);

    const outputDir = path.join(process.cwd(), 'real-pdf-audiobook-output');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const audioPath = path.join(outputDir, 'audiobook.wav');
    fs.writeFileSync(audioPath, audio.audio);

    console.log(`✓ Audio generated: ${(audio.audio.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`✓ Duration: ${Math.floor(audio.duration / 60)}m ${Math.floor(audio.duration % 60)}s`);
    console.log(`✓ Voice: Alex (real macOS voice)\n`);
    console.log(`✅ OUTPUT: ${audioPath}\n`);

    return true;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

convertRealPDF().then(ok => process.exit(ok ? 0 : 1));
