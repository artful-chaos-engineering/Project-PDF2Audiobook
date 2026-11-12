import { PDFExtractor } from './pdfExtractor';
import { cleanWithLLM, splitIntoSections } from './smartCleaner';
import { TTSConverter } from './ttsConverter';
import * as path from 'path';
import type { AudiobookConfig } from './types';

export const SECTION_PAUSE_SECONDS = 2.5;

export interface ProcessResult {
  outputPath: string;
  sectionCount: number;
  durationSeconds: number;
  sizeBytes: number;
}

export async function processPdf(filePath: string, outputDir: string, voice: string, log: (msg: string) => void = console.log): Promise<ProcessResult> {
  const fs = await import('fs');
  const outputFile = path.basename(filePath).replace(/\.pdf$/i, '-premium.mp3');

  log('1️⃣  Extracting PDF...');
  const extracted = await new PDFExtractor().extractFromFile(filePath);
  let fullText = '';
  for (const page of extracted.pages) {
    fullText += page.text + '\n\n';
  }

  const sections = splitIntoSections(fullText);
  log(`2️⃣  Intelligent cleaning (Claude) of ${sections.length} sections...`);
  const cleanedSections: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const cleaned = await cleanWithLLM(sections[i]);
    if (!cleaned.narrativeText) throw new Error(`Section ${i + 1} cleaned to empty text`);
    cleanedSections.push(cleaned.narrativeText);
    log(`   Section ${i + 1}/${sections.length}: ${sections[i].length} -> ${cleaned.narrativeText.length} chars`);
  }

  log(`   Voice: ${voice}`);
  log(`3️⃣  Generating premium audio with ${SECTION_PAUSE_SECONDS}s pauses between sections...`);
  const ttsConfig: AudiobookConfig = {
    pdfPath: filePath,
    outputPath: path.join(outputDir, outputFile),
    voiceProvider: 'elevenlabs',
    voice,
    speed: 1.0,
  };
  const conv = new TTSConverter(ttsConfig);
  const audio = await conv.convertSectionsToAudio(cleanedSections, ttsConfig, SECTION_PAUSE_SECONDS);

  fs.mkdirSync(outputDir, { recursive: true });
  const audioPath = path.join(outputDir, outputFile);
  fs.writeFileSync(audioPath, audio.audio);
  log(`✓ Saved: ${audioPath}`);

  return {
    outputPath: audioPath,
    sectionCount: sections.length,
    durationSeconds: audio.duration,
    sizeBytes: audio.audio.length,
  };
}
