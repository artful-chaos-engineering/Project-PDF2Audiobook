// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { PDFExtractor } from './pdfExtractor';
import { cleanWithLLM, splitIntoSections } from './smartCleaner';
import { TTSConverter } from './ttsConverter';
import * as path from 'path';
import type { AudiobookConfig } from './types';
import { buildSegments, Mode } from './modes';

export interface ProcessResult {
  outputPath: string;
  sectionCount: number;
  durationSeconds: number;
  sizeBytes: number;
}

export async function processPdf(filePath: string, outputDir: string, mode: Mode, log: (msg: string) => void = console.log): Promise<ProcessResult> {
  const fs = await import('fs');
  const outputFile = path.basename(filePath).replace(/\.pdf$/i, `-${mode}.mp3`);

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
    log(`   Section ${i + 1}/${sections.length}: ${sections[i].length} -> ${cleaned.narrativeText.length} chars`);
    if (cleaned.narrativeText) cleanedSections.push(cleaned.narrativeText);
  }
  if (cleanedSections.length === 0) throw new Error('No narrative text found in document');

  log(`3️⃣  Building ${mode} script...`);
  const segments = await buildSegments(mode, cleanedSections);
  log(`   ${segments.length} segments`);
  const ttsConfig: AudiobookConfig = {
    pdfPath: filePath,
    outputPath: path.join(outputDir, outputFile),
    voiceProvider: 'elevenlabs',
    speed: 0.9,
  };
  const conv = new TTSConverter(ttsConfig);
  log('4️⃣  Generating audio...');
  const audio = await conv.convertSegmentsToAudio(segments, ttsConfig);

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
