import * as path from 'path';
import * as fs from 'fs';

export interface Config {
  inputDir: string;
  outputDir: string;
}

export function getConfig(): Config {
  // Check environment variables first
  const inputDir = process.env.AUDIOBOOK_INPUT_DIR || 
                   path.join(process.cwd(), 'input');
  const outputDir = process.env.AUDIOBOOK_OUTPUT_DIR || 
                    path.join(process.cwd(), 'output');

  // Ensure directories exist
  if (!fs.existsSync(inputDir)) {
    fs.mkdirSync(inputDir, { recursive: true });
  }
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  return { inputDir, outputDir };
}
