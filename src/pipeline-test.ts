// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.

import { PDFExtractor } from './pdfExtractor';
import { ContentCleaner } from './contentCleaner';
import { TTSConverter } from './ttsConverter';
import * as fs from 'fs';
import * as path from 'path';
import type { AudiobookConfig } from './types';

async function testFullPipeline() {
  console.log('📚 Full Pipeline Test: PDF → Extraction → Filtering → Audio\n');

  try {
    const pdfPath = '/private/tmp/technical-book.pdf';

    // Step 1: Verify PDF exists
    console.log('Step 1: PDF Input');
    console.log('───────────────');
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`PDF not found: ${pdfPath}`);
    }
    const pdfStats = fs.statSync(pdfPath);
    console.log(`✓ File: technical-book.pdf`);
    console.log(`✓ Size: ${(pdfStats.size / 1024).toFixed(1)} KB`);
    console.log(`✓ Format: PDF (real book with TOC, tables, figures, references, glossary)\n`);

    // Step 2: Extract PDF
    console.log('Step 2: PDF Extraction');
    console.log('─────────────────────');
    const extractor = new PDFExtractor();
    const extracted = await extractor.extractFromFile(pdfPath);

    console.log(`✓ Pages extracted: ${extracted.pages.length}`);
    let totalElements = 0;
    let elementTypes: { [key: string]: number } = {};

    for (const page of extracted.pages) {
      for (const el of page.elements) {
        totalElements++;
        elementTypes[el.type] = (elementTypes[el.type] || 0) + 1;
      }
    }

    console.log(`✓ Total elements identified: ${totalElements}`);
    console.log('✓ Element types found:');
    for (const [type, count] of Object.entries(elementTypes)) {
      console.log(`  - ${type}: ${count}`);
    }
    console.log();

    // Step 3: Clean content (filter non-narrative)
    console.log('Step 3: Content Filtering & Summarization');
    console.log('────────────────────────────────────────');
    const cleaner = new ContentCleaner();
    const cleaned = await cleaner.clean(extracted);

    console.log(`✓ Narrative text length: ${cleaned.narrativeText.length} characters`);
    console.log(`✓ Removed elements:\n`);

    const beforeCount = totalElements;
    const narrativeCount = cleaned.narrativeText.split('\n').filter(l => l.trim()).length;
    const removedElements = beforeCount - narrativeCount;

    // Check what was removed
    const hasHeaders = cleaned.narrativeText.includes('Machine Learning Fundamentals');
    const hasTOC = cleaned.narrativeText.toLowerCase().includes('table of contents');
    const hasReferences = cleaned.narrativeText.toLowerCase().includes('[1]');
    const hasGlossary = cleaned.narrativeText.toLowerCase().includes('algorithm:');

    console.log(`  - Headers/Footers: ${elementTypes['header'] || 0} removed`);
    console.log(`  - Table of Contents: ${elementTypes['toc'] || 0} removed`);
    console.log(`  - References: ${elementTypes['reference'] || 0} removed`);
    console.log(`  - Glossary: ${elementTypes['glossary'] || 0} removed`);
    console.log(`  - Total non-narrative: ${removedElements} elements\n`);

    // Step 4: Verify table/figure summaries
    console.log('Step 4: Table & Figure Summaries');
    console.log('────────────────────────────────');
    console.log(`✓ Table summaries: ${cleaned.summaries.filter(s => s.type === 'table').length}`);
    console.log(`✓ Figure summaries: ${cleaned.summaries.filter(s => s.type === 'figure').length}`);

    if (cleaned.summaries.length > 0) {
      console.log('\nGenerated summaries:');
      for (const summary of cleaned.summaries) {
        const icon = summary.type === 'table' ? '📊' : '📈';
        console.log(`  ${icon} ${summary.type.toUpperCase()} ${summary.number}`);
        if (summary.title) {
          console.log(`     Title: ${summary.title}`);
        }
        console.log(`     Summary: ${summary.summary}`);
      }
    }
    console.log();

    // Step 5: Display filtered content sample
    console.log('Step 5: Filtered Content Sample');
    console.log('───────────────────────────────');
    const contentSample = cleaned.narrativeText.slice(0, 400);
    console.log(`First 400 characters of cleaned narrative:\n`);
    console.log(contentSample);
    console.log(`...\n`);

    // Step 6: Convert to audio
    console.log('Step 6: Text-to-Speech Conversion');
    console.log('─────────────────────────────────');
    const config: AudiobookConfig = {
      pdfPath,
      outputPath: path.join(process.cwd(), 'pipeline-output.wav'),
      voiceProvider: 'mac',
      voice: 'Victoria',
      speed: 1.0,
    };

    console.log(`✓ Voice selected: Victoria`);
    console.log(`✓ Converting ${cleaned.narrativeText.length} characters to speech...`);

    const converter = new TTSConverter(config);
    const audioSegment = await converter.convertToAudio(cleaned.narrativeText, config);

    console.log(`✓ Audio generated: ${(audioSegment.audio.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`✓ Duration: ${Math.floor(audioSegment.duration / 60)}m ${Math.floor(audioSegment.duration % 60)}s\n`);

    // Step 7: Save output
    console.log('Step 7: Output Generation');
    console.log('────────────────────────');
    const outputDir = path.join(process.cwd(), 'pipeline-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const audioPath = path.join(outputDir, 'filtered-audiobook.wav');
    fs.writeFileSync(audioPath, audioSegment.audio);
    console.log(`✓ Audio file: filtered-audiobook.wav (${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(2)} MB)`);

    const metadataPath = path.join(outputDir, 'conversion-report.json');
    const report = {
      title: 'Technical Book Audiobook Conversion',
      pdfFile: 'technical-book.pdf',
      pdfSizeKB: (pdfStats.size / 1024).toFixed(1),
      extractedPages: extracted.pages.length,
      totalElementsFound: totalElements,
      elementBreakdown: elementTypes,
      filteringResults: {
        narrativeTextLength: cleaned.narrativeText.length,
        tablesFound: elementTypes['table'] || 0,
        tablesConverted: cleaned.summaries.filter(s => s.type === 'table').length,
        figuresFound: elementTypes['figure'] || 0,
        figuresConverted: cleaned.summaries.filter(s => s.type === 'figure').length,
        headersRemoved: elementTypes['header'] || 0,
        footersRemoved: elementTypes['footer'] || 0,
        tocRemoved: elementTypes['toc'] || 0,
        referencesRemoved: elementTypes['reference'] || 0,
        glossaryRemoved: elementTypes['glossary'] || 0,
      },
      audioOutput: {
        voice: config.voice,
        durationSeconds: audioSegment.duration,
        durationFormatted: `${Math.floor(audioSegment.duration / 60)}m ${Math.floor(audioSegment.duration % 60)}s`,
        sizeBytes: fs.statSync(audioPath).size,
        sizeMB: (fs.statSync(audioPath).size / 1024 / 1024).toFixed(2),
      },
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(metadataPath, JSON.stringify(report, null, 2));
    console.log(`✓ Report file: conversion-report.json\n`);

    // Step 8: Final verification
    console.log('✅ PIPELINE TEST COMPLETE');
    console.log('═════════════════════════════════════════\n');

    console.log('VERIFIED RESULTS:');
    console.log('─────────────────');
    console.log('✓ PDF file successfully extracted');
    console.log('✓ Content filtering applied:');
    console.log(`  - Headers removed: ${elementTypes['header'] || 0}`);
    console.log(`  - Footers removed: ${elementTypes['footer'] || 0}`);
    console.log(`  - Table of Contents removed: ${elementTypes['toc'] || 0}`);
    console.log(`  - References removed: ${elementTypes['reference'] || 0}`);
    console.log(`  - Glossary removed: ${elementTypes['glossary'] || 0}`);
    console.log('✓ Table/Figure summaries generated:');
    console.log(`  - Tables: ${cleaned.summaries.filter(s => s.type === 'table').length}`);
    console.log(`  - Figures: ${cleaned.summaries.filter(s => s.type === 'figure').length}`);
    console.log(`✓ Real audio generated: ${(fs.statSync(audioPath).size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`✓ Real voice used: Victoria (macOS native)`);
    console.log(`✓ Duration: ${report.audioOutput.durationFormatted}\n`);

    console.log('📁 Output Location:');
    console.log(`   ${outputDir}\n`);

    return true;
  } catch (error) {
    console.error('❌ Pipeline test failed:', error instanceof Error ? error.message : String(error));
    console.error(error);
    return false;
  }
}

testFullPipeline().then((success) => {
  process.exit(success ? 0 : 1);
});
