# Architecture Overview

## System Design

The PDF2Audiobook converter is built as a modular pipeline with clear separation of concerns:

```
PDF Input
   ↓
┌──────────────────────┐
│  PDF Extractor       │  - Parse PDF pages
│                      │  - Identify content types
│  → PDFExtractor      │  - Extract text & metadata
└──────────────────────┘
   ↓
 Extracted Content
   ↓
┌──────────────────────┐
│ Content Cleaner      │  - Filter non-narrative
│                      │  - Summarize tables
│  → ContentCleaner    │  - Summarize figures
└──────────────────────┘
   ↓
Cleaned Narrative + Summaries
   ↓
┌──────────────────────┐
│ TTS Converter        │  - Connect to provider
│                      │  - Split into chunks
│  → TTSConverter      │  - Synthesize audio
└──────────────────────┘
   ↓
 Audio Segments
   ↓
┌──────────────────────┐
│ Audio Assembler      │  - Concatenate segments
│                      │  - Add metadata
│  → AudioAssembler    │  - Format output
└──────────────────────┘
   ↓
 Audio + Metadata
   ↓
┌──────────────────────┐
│  Audiobook Generator │  - Orchestrate pipeline
│                      │  - Write files
│  → AudiobookGenerator│  - Report progress
└──────────────────────┘
   ↓
MP3 Output + JSON Metadata
```

## Module Responsibilities

### 1. PDFExtractor (`pdfExtractor.ts`)

**Responsibility:** Extract text from PDF and identify content types

**Methods:**
- `extractFromFile(pdfPath)` - Main entry point
- `identifyElements(text, pageNum)` - Classify content
- Detection methods for each type:
  - `isHeader()` - Running page headers
  - `isFooter()` - Page numbers/footers
  - `isTableOfContents()` - Navigation
  - `isTableContent()` - Data tables
  - `isFigureCaption()` - Figure references
  - `isReference()` - Citation sections
  - `isGlossary()` - Term definitions
  - `isHeading()` - Section headings

**Output:** `ExtractedContent` with pages and metadata

**Key Decisions:**
- Regex-based pattern matching (fast, no ML needed)
- Per-line classification with context awareness
- Heading level inference from length/format

### 2. ContentCleaner (`contentCleaner.ts`)

**Responsibility:** Filter non-narrative and summarize tables/figures

**Methods:**
- `clean(extracted)` - Main cleaning pass
- `summarizeTable(content)` - Generate table description
- `summarizeFigure(content)` - Generate figure description
- Helper methods:
  - `extractTableNumber/FigureNumber()` - Parse references
  - `extractTableHeaders()` - Identify columns
  - `formatSummaryInsertion()` - Create readable summary

**Output:** `CleanedContent` with narrative and summaries

**Key Decisions:**
- Discard non-narrative elements entirely
- Keep narrative and headings as-is
- Insert summaries back into narrative flow
- Smart extraction of table headers and figure captions

### 3. TTSConverter (`ttsConverter.ts`)

**Responsibility:** Convert text to speech audio

**Components:**
- `TTSConverter` - Main class, provider abstraction
- `ElevenLabsTTS` - ElevenLabs implementation
- `GoogleTTS` - Google Cloud implementation

**Methods:**
- `convertToAudio(text)` - Main entry point
- `getAvailableVoices()` - List options
- `chunkText(text)` - Split into safe chunks
- Provider implementations with API calls

**Output:** `AudioSegment` with MP3 buffer and metadata

**Key Decisions:**
- Provider abstraction for extensibility
- Chunk-based processing to avoid token limits
- Voice mapping for cross-provider compatibility
- Error handling for API failures

### 4. AudioAssembler (`audioAssembler.ts`)

**Responsibility:** Combine audio segments and add metadata

**Methods:**
- `assembleSegments(segments)` - Concatenate audio
- `addMetadata(buffer, metadata)` - Add ID3 tags
- `calculateTotalDuration()` - Sum durations
- `formatDuration()` - Human-readable time

**Output:** Final MP3 buffer with metadata

**Key Decisions:**
- Simple buffer concatenation for MVP
- Extensible for future audio processing (crossfade, normalization)
- Duration calculation from text length heuristic

### 5. AudiobookGenerator (`audiobook.ts`)

**Responsibility:** Orchestrate entire pipeline

**Methods:**
- `generate()` - Main workflow
- `validateConfig()` - Verify inputs
- `ensureOutputDirectory()` - Create paths
- `generateMetadata()` - Write JSON stats

**Output:** MP3 file and metadata JSON

**Key Decisions:**
- Synchronous workflow for simplicity
- Detailed logging at each step
- Metadata JSON for debugging/tracking

### 6. CLI (`index.ts`)

**Responsibility:** Parse arguments and invoke generator

**Methods:**
- `parseArguments()` - CLI parsing
- `printUsage()` - Help text

**Input:** Command line arguments
**Output:** Invoked AudiobookGenerator or error

## Data Flow

### Type Definitions (`types.ts`)

```typescript
// Input from PDF
ExtractedContent
├── pages: Page[]
│   ├── pageNumber: number
│   ├── text: string
│   └── elements: ContentElement[]
│       ├── type: 'heading' | 'body' | 'table' | ...
│       ├── content: string
│       └── level?: number
└── metadata: { title?, author?, pageCount }

// After cleaning
CleanedContent
├── narrativeText: string
└── summaries: TableFigureSummary[]
    ├── type: 'table' | 'figure'
    ├── number: string
    ├── summary: string
    └── insertedAt: number

// Audio output
AudioSegment
├── text: string
├── audio: Buffer (MP3)
├── duration: number
└── voice?: string

// Configuration
AudiobookConfig
├── pdfPath: string
├── outputPath: string
├── voiceProvider: 'elevenlabs' | 'google'
├── voice?: string
├── language?: string
└── speed?: number
```

## Processing Pipeline Example

**Input:** `technical-book.pdf` (400 pages)

**Stage 1: Extraction**
```
Page 1-5: Front matter (TOC removed)
Page 6-395: Body text + 15 tables + 10 figures
Page 396-400: References + glossary (removed)
Result: 390 pages of narrative + 25 summaries
```

**Stage 2: Cleaning**
```
Headers: 400 removed (1 per page)
Footers: 400 removed (1 per page)
TOC: 15 removed
References: 20 removed
Glossary: 10 removed
Narrative kept: ~200,000 words
Table summaries: 15
Figure summaries: 10
```

**Stage 3: TTS**
```
Text split into 8 chunks (~25,000 words each)
Each chunk sent to ElevenLabs API
Audio returned: ~30 min per chunk
Total: ~4 hours of audio
```

**Stage 4: Assembly**
```
8 audio segments concatenated
Metadata added (duration, title, etc.)
Total output: ~500-600 MB MP3 file
```

## Error Handling

### At Each Stage

**Extraction:**
- PDF file not found → Exit with clear error
- Corrupted PDF → Graceful degradation, log warning
- Text extraction failure → Skip page, log warning

**Cleaning:**
- Empty narrative → Warn user
- All content filtered → Error exit

**TTS:**
- API key missing → Exit with help text
- API rate limit → Retry with backoff
- Network timeout → Retry up to 3 times

**Assembly:**
- Buffer concatenation failure → Error exit
- Write permission denied → Error exit

## Extensibility Points

### Add New TTS Provider

1. Implement `TTSProvider` interface
2. Add case in `TTSConverter.getProvider()`
3. Set environment variable for API key

```typescript
export class AzureTTS implements TTSProvider {
  async synthesize(text: string, config: AudiobookConfig): Promise<Buffer> {
    // Implementation
  }
  async getAvailableVoices(): Promise<string[]> {
    // Implementation
  }
}
```

### Customize Filtering

Edit `PDFExtractor` detection methods:
```typescript
private isHeading(text: string): boolean {
  // Modify pattern matching logic
}
```

### Add Post-Processing

Extend `AudioAssembler`:
```typescript
async normalizeAudio(buffer: Buffer): Promise<Buffer> {
  // Use FFmpeg or similar
}
```

## Performance Characteristics

- **PDF extraction:** O(n) where n = PDF size
- **Content cleaning:** O(n) where n = extracted text
- **TTS:** Linear with text length (5000 chars ≈ 2-3 min wait)
- **Assembly:** O(n) where n = number of segments
- **Overall:** Dominated by TTS API calls (network-bound)

**For 400-page technical book:**
- Extraction: ~2-5 seconds
- Cleaning: ~1-2 seconds
- TTS: ~4-6 hours (8 chunks × 30-45 min each)
- Assembly: ~1 second
- **Total: ~4-6 hours** (mostly network/API)

## Dependencies

### Production
- `pdf-parse` - PDF text extraction
- `pdfjs-dist` - PDF parsing engine
- `elevenlabs` - ElevenLabs API client (optional)

### Development
- `typescript` - Type safety
- `ts-node` - Run TypeScript directly
- `tsx` - Alternative TypeScript runner

## Security Considerations

1. **API Keys:**
   - Read from environment variables only
   - Never commit to git
   - Validate before use

2. **User Input:**
   - Validate file paths
   - Check file exists and readable
   - Prevent path traversal

3. **External API Calls:**
   - Validate API responses
   - Handle SSL/TLS properly
   - Timeout long-running requests

4. **Output Files:**
   - Create in safe directory
   - Don't overwrite without confirmation
   - Validate paths

## Testing Strategy

Would include:
- Unit tests for detection methods
- Integration tests for full pipeline
- Fixture PDFs with known outputs
- Error case testing
- Performance benchmarks

See `src/example.ts` for demonstration of workflow.
