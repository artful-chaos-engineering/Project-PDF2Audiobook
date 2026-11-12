import { PDFExtractor } from './pdfExtractor';
import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import type { AudiobookConfig } from './types';

async function processManagersCourse() {
  const pdfPath = '/Users/markvriesenga/Private/201-Agentic AI Projects/__Code-ArtfulChaos/Project-PDF2Audiobook/.vscode/input/ArtfulChaos_Course_IntroductionForManagers_v2.0.pdf';
  
  console.log('📚 PROCESSING: ArtfulChaos - Introduction for Managers\n');
  console.log('='  .repeat(70) + '\n');

  // Extract PDF
  console.log('STEP 1: Extracting PDF content...');
  const extractor = new PDFExtractor();
  const extracted = await extractor.extractFromFile(pdfPath);

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

  console.log(`✓ Pages: ${extracted.pages.length}`);
  console.log(`✓ Elements: ${counts.body} body + ${counts.table} tables + ${counts.fig} figures`);
  console.log(`✓ Filtering: ${counts.header} headers + ${counts.toc} TOC + ${counts.ref} refs + ${counts.gloss} glossary\n`);

  // Clean and filter
  console.log('STEP 2: Filtering non-narrative content...');
  const cleaner = new ContentCleaner();
  const cleaned = await cleaner.clean(extracted);
  
  console.log(`✓ Narrative: ${cleaned.narrativeText.length} characters`);
  console.log(`✓ Summaries: ${cleaned.summaries.length} items`);
  console.log(`✓ Removed: ${counts.toc + counts.ref + counts.gloss + counts.header + counts.footer} non-narrative elements\n`);

  // Show summaries
  if (cleaned.summaries.length > 0) {
    console.log('TABLE & FIGURE SUMMARIES:');
    for (const s of cleaned.summaries) {
      const type = s.type === 'table' ? 'Table' : 'Figure';
      console.log(`  ${type} ${s.number}: ${s.summary.substring(0, 70)}...`);
    }
    console.log();
  }

  // Convert to audio
  console.log('STEP 3: Converting to high-quality MP3 audio...');
  console.log('  Voice: Samantha (professional female speaker)');
  console.log('  Bitrate: 128 kbps (high quality)');
  console.log('  Sample rate: 22.05 kHz');
  
  const config: AudiobookConfig = {
    pdfPath,
    outputPath: path.join(process.cwd(), 'managers-course.mp3'),
    voiceProvider: 'mac',
    voice: 'Samantha',
    speed: 1.0,
  };

  const conv = new TTSConverter(config);
  const audio = await conv.convertToAudio(cleaned.narrativeText, config);

  const outDir = path.join(process.cwd(), '.vscode/output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  
  const audioPath = path.join(outDir, 'ArtfulChaos_IntroductionForManagers.mp3');
  fs.writeFileSync(audioPath, audio.audio);

  const stats = fs.statSync(audioPath);
  const durationMin = Math.floor(audio.duration / 60);
  const durationSec = Math.floor(audio.duration % 60);

  console.log(`✓ Audio generated successfully\n`);

  console.log('='  .repeat(70));
  console.log('\n✅ AUDIOBOOK COMPLETE\n');
  console.log('OUTPUT:');
  console.log(`  File: ${audioPath}`);
  console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Duration: ${durationMin}m ${durationSec}s`);
  console.log(`  Format: MP3 (128 kbps, high quality)`);
  console.log(`  Voice: Samantha (professional English speaker)\n`);

  return true;
}

processManagersCourse()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
