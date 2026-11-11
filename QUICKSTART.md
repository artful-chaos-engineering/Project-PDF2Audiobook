# Quick Start Guide

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up your API key. Choose one:

   **ElevenLabs (Recommended - natural voices):**
   ```bash
   export ELEVENLABS_API_KEY="sk_your_key_here"
   ```

   **Google Cloud:**
   ```bash
   export GOOGLE_API_KEY="your_key_here"
   ```

## Basic Usage

Convert your first PDF to audiobook:

```bash
npm start -- /path/to/book.pdf
```

This creates `book.mp3` in the same directory.

## Examples

### With custom output path
```bash
npm start -- book.pdf --output my-audiobook.mp3
```

### With different voice (ElevenLabs)
```bash
npm start -- book.pdf --voice rachel
```

### Faster speech
```bash
npm start -- book.pdf --speed 1.5
```

### Google Cloud TTS
```bash
npm start -- book.pdf --provider google --voice en-US-Neural2-C
```

### All options combined
```bash
npm start -- book.pdf \
  --output audiobook.mp3 \
  --provider elevenlabs \
  --voice bella \
  --speed 1.25 \
  --language en
```

## What Gets Filtered

The converter automatically removes:
- ✗ Page headers and footers
- ✗ Table of contents
- ✗ Figure headings (kept as summaries)
- ✗ Table data (kept as summaries)
- ✗ References/Bibliography
- ✗ Glossary/Appendices
- ✓ Body text (narrative)
- ✓ Chapter headings
- ✓ Section headings
- ✓ Brief table/figure descriptions

## Output Files

For input `book.pdf`, you'll get:
- `book.mp3` - The audiobook (MP3 format)
- `book.json` - Metadata (duration, stats, etc.)

## Voices Available

### ElevenLabs
- bella (female, natural)
- rachel (female, professional)
- domi (female, warm)
- antoni (male, deep)

See [elevenlabs.io](https://elevenlabs.io) for complete list.

### Google Cloud
- en-US-Neural2-A through en-US-Neural2-F
- Other language options available

See [Google Cloud docs](https://cloud.google.com/text-to-speech/docs/voices) for complete list.

## Troubleshooting

### "API key not found"
Make sure you've set the environment variable:
```bash
export ELEVENLABS_API_KEY="your_key"
echo $ELEVENLABS_API_KEY  # verify it's set
```

### "PDF file not found"
Use absolute paths or relative paths from the project root:
```bash
npm start -- $(pwd)/book.pdf
```

### Getting started with API keys

**ElevenLabs:**
1. Go to https://elevenlabs.io
2. Sign up for free account
3. Get your API key from the account settings
4. Start with free tier quota

**Google Cloud:**
1. Go to https://console.cloud.google.com
2. Create a new project
3. Enable "Cloud Text-to-Speech API"
4. Create a service account key
5. Use the credentials JSON

## Performance Tips

- **Quality**: Default settings are optimal
- **Speed**: Use `--speed 1.0` to 2.0 (higher = faster talking)
- **Large PDFs**: Break into chapters if taking too long
- **Network**: Keep internet stable during conversion

## Need Help?

See [README.md](README.md) for full documentation.
