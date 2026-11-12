#!/usr/bin/env node
// Copyright (c) 2026 Mark Vriesenga
// SPDX-License-Identifier: MIT
// Licensed under the MIT License. See the LICENSE file in the project root.


import * as path from 'path';
import { AudiobookGenerator } from './audiobook';
import type { AudiobookConfig } from './types';

async function main() {
  const args = process.argv.slice(2);

  // Parse command line arguments
  const config = parseArguments(args);

  if (!config) {
    printUsage();
    process.exit(1);
  }

  try {
    const generator = new AudiobookGenerator(config);
    await generator.generate();
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function parseArguments(args: string[]): AudiobookConfig | null {
  const config: Partial<AudiobookConfig> = {
    voiceProvider: 'elevenlabs',
    language: 'en',
    speed: 1.0,
  };

  let pdfPath = '';
  let outputPath = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--pdf' || arg === '-p') {
      pdfPath = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      outputPath = args[++i];
    } else if (arg === '--provider') {
      const provider = args[++i];
      if (['elevenlabs', 'google', 'azure'].includes(provider)) {
        config.voiceProvider = provider as 'elevenlabs' | 'google' | 'azure';
      } else {
        console.error(`Error: Unknown provider "${provider}". Use: elevenlabs, google, or azure`);
        return null;
      }
    } else if (arg === '--voice' || arg === '-v') {
      config.voice = args[++i];
    } else if (arg === '--language' || arg === '-l') {
      config.language = args[++i];
    } else if (arg === '--speed' || arg === '-s') {
      const speed = parseFloat(args[++i]);
      if (isNaN(speed) || speed < 0.5 || speed > 2.0) {
        console.error('Error: Speed must be between 0.5 and 2.0');
        return null;
      }
      config.speed = speed;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      return null;
    } else if (!arg.startsWith('-') && !pdfPath) {
      pdfPath = arg;
    } else if (arg.startsWith('-')) {
      console.error(`Error: Unknown option "${arg}". Use --help for usage.`);
      return null;
    }
  }

  if (!pdfPath) {
    console.error('Error: PDF path is required');
    console.error('Use: pdf2audiobook <pdf-path> [options]');
    console.error('Use: pdf2audiobook --help for full usage information');
    return null;
  }

  // Resolve paths
  config.pdfPath = path.resolve(pdfPath);

  if (!outputPath) {
    const baseName = path.basename(pdfPath, path.extname(pdfPath));
    outputPath = path.join(path.dirname(config.pdfPath), `${baseName}.mp3`);
  }
  config.outputPath = path.resolve(outputPath);

  return config as AudiobookConfig;
}

function printUsage(): void {
  console.log(`
📖 PDF to Audiobook Converter

Usage:
  pdf2audiobook <pdf-path> [options]

Options:
  --pdf, -p <path>        Path to PDF file (can also be first argument)
  --output, -o <path>     Output audio file path (default: <pdf-name>.mp3)
  --provider              TTS provider: elevenlabs, google (default: elevenlabs)
  --voice, -v <voice>     Voice name (e.g., bella, rachel)
  --language, -l <lang>   Language code (default: en)
  --speed, -s <speed>     Speaking speed 0.5-2.0 (default: 1.0)
  --help, -h              Show this help message

Examples:
  pdf2audiobook book.pdf
  pdf2audiobook book.pdf --output book.mp3
  pdf2audiobook book.pdf --provider google --voice en-US-Neural2-A
  pdf2audiobook book.pdf --speed 1.25 --voice bella

Environment Variables:
  ELEVENLABS_API_KEY      API key for ElevenLabs TTS
  GOOGLE_API_KEY          API key for Google Cloud TTS

`);
}

main().catch(err => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
