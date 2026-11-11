# Development Guide

## Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run with ts-node
npm run dev

# Run compiled version
npm start -- path/to/book.pdf
```

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── types.ts              # TypeScript interfaces
├── pdfExtractor.ts       # PDF text extraction
├── contentCleaner.ts     # Content filtering
├── ttsConverter.ts       # Text-to-speech
├── audioAssembler.ts     # Audio assembly
├── audiobook.ts          # Main orchestrator
└── example.ts            # Demo/documentation

docs/
├── ARCHITECTURE.md       # System design
├── FILTERING_ALGORITHM.md # Content detection
├── DEVELOPMENT.md        # This file

test/
└── (would contain test fixtures)

dist/                      # Compiled output
```

## Key Design Principles

1. **Modularity:** Each component has single responsibility
2. **Type Safety:** Full TypeScript with strict mode
3. **Extensibility:** Abstract interfaces for providers
4. **Error Handling:** Clear error messages, graceful degradation
5. **Simplicity:** Prefer simple patterns over complex abstractions

## Adding a New TTS Provider

### 1. Create provider class

```typescript
// src/ttsConverter.ts (add to file)
export class MyProviderTTS implements TTSProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.MYPROVIDER_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('MyProvider API key not found.');
    }
  }

  async synthesize(text: string, config: AudiobookConfig): Promise<Buffer> {
    const response = await fetch('https://api.myprovider.com/synthesize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice: config.voice || 'default',
        language: config.language || 'en',
        speed: config.speed || 1.0,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async getAvailableVoices(): Promise<string[]> {
    const response = await fetch('https://api.myprovider.com/voices', {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });
    const data = await response.json() as { voices: Array<{ name: string }> };
    return data.voices.map(v => v.name);
  }
}
```

### 2. Register in TTSConverter

```typescript
// In src/ttsConverter.ts, method getProvider()
private getProvider(providerName: string, config: AudiobookConfig): TTSProvider {
  switch (providerName) {
    case 'elevenlabs':
      return new ElevenLabsTTS();
    case 'google':
      return new GoogleTTS();
    case 'myprovider':
      return new MyProviderTTS();
    default:
      throw new Error(`Unknown TTS provider: ${providerName}`);
  }
}
```

### 3. Update CLI

```typescript
// In src/index.ts, function parseArguments()
// In the if/else, add:
if (['elevenlabs', 'google', 'myprovider'].includes(provider)) {
  config.voiceProvider = provider as 'elevenlabs' | 'google' | 'myprovider';
}
```

### 4. Update types

```typescript
// In src/types.ts
export interface AudiobookConfig {
  // ...
  voiceProvider: 'elevenlabs' | 'google' | 'myprovider';
}
```

## Improving Content Detection

### Adding new element type

1. **Update types** (`src/types.ts`):
```typescript
type ContentElement = 
  | 'heading' | 'body' | 'table' | 'figure' | 'reference' | 'toc'
  | 'glossary' | 'header' | 'footer'
  | 'mynewtype'  // Add here
```

2. **Add detection method** (`src/pdfExtractor.ts`):
```typescript
private isMyNewType(text: string): boolean {
  const trimmed = text.trim();
  return /^my.*pattern/.test(trimmed);
}
```

3. **Add to classification** (`src/pdfExtractor.ts`, `identifyElements()`):
```typescript
} else if (this.isMyNewType(trimmed)) {
  this.flushElement(elements, currentElement);
  currentElement = { type: 'mynewtype', content: trimmed };
}
```

4. **Handle in cleaning** (`src/contentCleaner.ts`):
```typescript
case 'mynewtype':
  // Remove or process
  break;
```

## Testing Content Filters

Create test PDFs with known structure:

```bash
# Test with simple text file (convert to PDF)
echo "Header
Table 1: Data
---
Row 1    Col 1
Row 2    Col 2

Main text here.

References
[1] Source" > test.txt
```

Then verify extraction:

```typescript
// Quick test
import { PDFExtractor } from './pdfExtractor';

const extractor = new PDFExtractor();
const result = await extractor.extractFromFile('test.pdf');
console.log(JSON.stringify(result, null, 2));
```

## Performance Optimization

### Current bottlenecks:
1. **TTS API calls** - Network latency (main bottleneck)
2. **PDF parsing** - For very large files (>1000 pages)
3. **Text chunking** - Inefficient for very long documents

### Optimization opportunities:

1. **Parallel TTS calls:**
```typescript
// In TTSConverter.convertToAudio()
// Send multiple chunks concurrently:
const audioBuffers = await Promise.all(
  chunks.map(chunk => this.provider.synthesize(chunk, config))
);
```

2. **Caching:**
```typescript
// Cache voice lists and API responses
private voiceCache: Map<string, string[]> = new Map();
```

3. **Streaming:**
```typescript
// Stream audio output instead of buffering
// Useful for very long books
```

## Debugging

### Enable verbose logging:
```typescript
// In audiobook.ts, add debug output
console.debug(`[DEBUG] Extraction took ${Date.now() - start}ms`);
```

### Test individual components:
```bash
# Just extraction
npm start -- book.pdf 2>&1 | grep "Step 1"

# Just cleaning
node -e "
import { PDFExtractor } from './src/pdfExtractor';
import { ContentCleaner } from './src/contentCleaner';
const e = new PDFExtractor();
const extracted = await e.extractFromFile('book.pdf');
const c = new ContentCleaner();
const cleaned = await c.clean(extracted);
console.log(cleaned);
"
```

## Common Issues

### 1. PDF extraction gets wrong content type

**Solution:** Debug the detection regex

```typescript
const text = 'SUSPICIOUS TEXT';
console.log('Is header?', this.isHeader(text));
console.log('Is body?', this.isTableContent(text));
```

Then adjust patterns in detection methods.

### 2. Table/figure summaries are wrong

**Solution:** Improve extraction logic

```typescript
// In contentCleaner.ts
private extractTableHeaders(content: string): string[] {
  // Debug: log what we're extracting
  console.log('Input:', content.slice(0, 100));
  // ... extraction logic ...
  console.log('Headers:', headers);
  return headers;
}
```

### 3. TTS API fails

**Solution:** Check configuration and errors

```bash
# Test API key
curl -X GET "https://api.elevenlabs.io/v1/voices" \
  -H "xi-api-key: $ELEVENLABS_API_KEY"
```

## Code Style

- Use TypeScript strict mode
- Prefer const/let over var
- Use arrow functions
- Add JSDoc comments for public methods
- Keep functions <50 lines
- Use descriptive variable names

Example:

```typescript
/**
 * Extracts column headers from table content.
 * @param content - The table text to parse
 * @returns Array of column header strings
 */
private extractTableHeaders(content: string): string[] {
  // Implementation
}
```

## Commit Guidelines

- Atomic commits: one feature/fix per commit
- Clear messages: "Add X", "Fix Y", "Improve Z"
- Reference issues: "Fix #123"
- Include breaking changes: "BREAKING: Remove X"

Example:
```
Add support for Google Cloud TTS provider

- Implement GoogleTTS class
- Add provider selection in CLI
- Update documentation with Google setup steps

Resolves #15
```

## Documentation

- Keep README.md up to date
- Document new environment variables
- Update QUICKSTART for new features
- Add architecture notes for complex changes
- Comment why, not what

## Future Improvements

1. **Audio Processing:**
   - FFmpeg integration for better audio control
   - Crossfading between segments
   - Audio normalization/compression
   - Adding background music

2. **ML-Based Filtering:**
   - Train classifier on real PDFs
   - Detect different content types more accurately
   - Learn book-specific patterns

3. **Multiple Voices:**
   - Different voices for chapters
   - Character voices for dialogue
   - Emphasis on important sections

4. **Offline Support:**
   - Local TTS engine (e.g., espeak)
   - Cached voice samples
   - Offline API simulation

5. **Performance:**
   - Parallel chunk processing
   - Streaming output
   - Caching strategies

6. **UI:**
   - Web interface for conversion
   - Progress tracking
   - Voice preview

7. **Testing:**
   - Unit test suite
   - Integration tests
   - Fixture PDFs for testing
   - Performance benchmarks

## Questions?

See ARCHITECTURE.md for system overview or FILTERING_ALGORITHM.md for content detection details.
