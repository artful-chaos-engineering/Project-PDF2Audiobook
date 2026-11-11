# PDF to Audiobook Converter

Convert technical PDF books into audiobooks with real voices. This tool intelligently extracts narrative content, skips non-essential elements (headers, footers, tables of contents), and summarizes tables and figures inline.

## Features

- **Smart Content Extraction**: Automatically identifies and extracts narrative text from PDFs
- **Intelligent Filtering**: Removes non-narrative content:
  - Headers and footers
  - Table of contents
  - References and glossaries
  - Figure and table headings

- **Table/Figure Summarization**: Generates brief summaries of tables and figures that are inserted naturally into the narrative
- **Real Voice Synthesis**: Multiple TTS providers with voice selection:
  - ElevenLabs (natural-sounding voices)
  - Google Cloud Text-to-Speech (neural voices)
  - Azure Speech Services (coming soon)

- **Configurable Output**: Adjust speaking speed, language, and voice

## Installation

```bash
npm install
npm run build
```

## Usage

### Basic Usage

```bash
npm start -- path/to/book.pdf
```

This will create `book.mp3` in the same directory.

### Advanced Options

```bash
npm start -- book.pdf \
  --output audiobook.mp3 \
  --provider elevenlabs \
  --voice bella \
  --speed 1.25
```

### Command Line Options

- `--pdf, -p <path>` - Path to PDF file
- `--output, -o <path>` - Output audio file (default: `<pdf-name>.mp3`)
- `--provider` - TTS provider: `elevenlabs`, `google` (default: `elevenlabs`)
- `--voice, -v <voice>` - Voice name
- `--language, -l <lang>` - Language code (default: `en`)
- `--speed, -s <speed>` - Speaking speed 0.5-2.0 (default: 1.0)

## Configuration

### API Keys

Set these environment variables:

```bash
export ELEVENLABS_API_KEY="your-api-key"
export GOOGLE_API_KEY="your-api-key"
```

### ElevenLabs

Get a free account at [elevenlabs.io](https://elevenlabs.io)

Available voices: bella, rachel, domi, antoni, and more

### Google Cloud

Set up a project and create API credentials at [console.cloud.google.com](https://console.cloud.google.com)

Available voices: en-US-Neural2-A, en-US-Neural2-C, and more

## How It Works

### 1. PDF Extraction
- Extracts text from each page
- Identifies content types (headings, body, tables, figures, etc.)

### 2. Content Cleaning
- Removes non-narrative elements
- Summarizes tables and figures
- Inserts summaries naturally into narrative flow

### 3. Text-to-Speech
- Splits narrative text into chunks
- Sends to selected TTS provider
- Combines audio segments

### 4. Output
- Saves MP3 audiobook
- Generates metadata JSON file

## Example Output

For a PDF with:
- 400 pages
- 5 tables
- 10 figures
- 200,000 words

Output:
- `book.mp3` (4-6 hours of audio, depending on speed)
- `book.json` (metadata with duration and word count)

## Architecture

```
src/
├── index.ts              # CLI entry point
├── types.ts              # TypeScript interfaces
├── pdfExtractor.ts       # PDF text extraction
├── contentCleaner.ts     # Content filtering & summarization
├── ttsConverter.ts       # Text-to-speech conversion
└── audiobook.ts          # Main orchestrator
```

## Development

```bash
npm run dev          # Run with ts-node
npm run build        # Build TypeScript
npm run test         # Run tests
```

## Limitations

- Requires API keys for TTS providers (some have free tiers)
- Works best with well-structured PDFs
- May need manual tuning for unusual layouts
- Audio quality depends on TTS provider

## License

MIT
