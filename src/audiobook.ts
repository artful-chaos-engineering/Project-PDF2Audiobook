// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import * as fs from 'fs';
import * as path from 'path';
import { PDFExtractor } from './pdfExtractor';
import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import type { AudiobookConfig } from './types';

export class AudiobookGenerator {
  private config: AudiobookConfig;

  constructor(config: AudiobookConfig) {
    this.config = config;
    this.validateConfig();
  }

  async generate(): Promise<void> {
    console.log(`📖 Starting PDF to Audiobook conversion...`);
    console.log(`   PDF: ${this.config.pdfPath}`);
    console.log(`   Provider: ${this.config.voiceProvider}`);
    console.log(`   Voice: ${this.config.voice || 'default'}`);

    // Step 1: Extract content from PDF
    console.log(`\n📄 Step 1: Extracting content from PDF...`);
    const extractor = new PDFExtractor();
    const extracted = await extractor.extractFromFile(this.config.pdfPath);
    console.log(`   ✓ Extracted ${extracted.pages.length} pages`);

    // Step 2: Clean content (remove non-narrative, summarize tables/figures)
    console.log(`\n🧹 Step 2: Cleaning content...`);
    const cleaner = new ContentCleaner();
    const cleaned = await cleaner.clean(extracted);
    console.log(`   ✓ Narrative text ready: ${cleaned.narrativeText.length} characters`);
    console.log(`   ✓ Table/figure summaries: ${cleaned.summaries.length}`);

    // Step 3: Convert to audio
    console.log(`\n🎙️  Step 3: Converting text to audio...`);
    const converter = new TTSConverter(this.config);
    const audioSegment = await converter.convertToAudio(cleaned.narrativeText, this.config);
    console.log(`   ✓ Audio generated: ${audioSegment.duration.toFixed(1)} seconds`);

    // Step 4: Save audiobook
    console.log(`\n💾 Step 4: Saving audiobook...`);
    this.ensureOutputDirectory();
    fs.writeFileSync(this.config.outputPath, audioSegment.audio);
    console.log(`   ✓ Saved to: ${this.config.outputPath}`);

    // Generate metadata
    this.generateMetadata(cleaned.narrativeText, audioSegment.duration);

    console.log(`\n✨ Audiobook conversion complete!`);
    console.log(`   Duration: ${this.formatDuration(audioSegment.duration)}`);
  }

  private generateMetadata(narrativeText: string, duration: number): void {
    const metadataPath = this.config.outputPath.replace(/\.[^.]+$/, '.json');
    const metadata = {
      title: this.config.pdfPath.split(path.sep).pop(),
      duration,
      durationFormatted: this.formatDuration(duration),
      textLength: narrativeText.length,
      characterCount: narrativeText.length,
      estimatedReadingTime: Math.ceil(narrativeText.length / 1000 / 200), // ~200 words per minute
      voice: this.config.voice,
      voiceProvider: this.config.voiceProvider,
      language: this.config.language || 'en',
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`   ✓ Metadata saved to: ${metadataPath}`);
  }

  private validateConfig(): void {
    if (!this.config.pdfPath) {
      throw new Error('PDF path must be specified');
    }

    if (!fs.existsSync(this.config.pdfPath)) {
      throw new Error(`PDF file not found: ${this.config.pdfPath}\n\nMake sure the file exists and the path is correct.`);
    }

    if (!fs.statSync(this.config.pdfPath).isFile()) {
      throw new Error(`PDF path is not a file: ${this.config.pdfPath}`);
    }

    if (!this.config.voiceProvider) {
      throw new Error('Voice provider must be specified (elevenlabs, google, or azure)');
    }

    if (this.config.speed && (this.config.speed < 0.5 || this.config.speed > 2.0)) {
      throw new Error('Speed must be between 0.5 and 2.0');
    }

    if (this.config.language && !/^[a-z]{2}(-[A-Z]{2})?$/.test(this.config.language)) {
      throw new Error(`Invalid language code: ${this.config.language} (use en, en-US, etc.)`);
    }
  }

  private ensureOutputDirectory(): void {
    const dir = path.dirname(this.config.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  }
}
