# PDF to Audiobook

Turns a technical PDF into an audiobook read by two AI voices. Narration reads the book in order. Podcast, debate, deep-dive and summary modes turn each section into a spoken conversation or summary, written by Claude and read by ElevenLabs.

## Features

- Extracts text from PDFs and removes non-narrative material: table of contents, headers and footers, References, glossary, code blocks, and table data. Figure captions are replaced with one short descriptive sentence.
- Keeps the narrative text word for word in narration mode.
- Two presenters, a female host (Sarah) and a male host (Brian), with pauses that vary statistically between sentences and speakers.
- Eight conversational formats, in technical and managerial variants, plus narration.
- An introduction and a closing recap for every script mode.
- A command-line launcher and a local web app with a mode picker.

## Requirements

| Requirement | Why | Install (macOS) |
|---|---|---|
| macOS | Tested on macOS; the web launcher opens Brave, Chrome or Firefox | — |
| Node.js 20 or newer, with npm | Runs the TypeScript app through `npx tsx` | `brew install node` |
| Python 3 with `pypdf` | PDF text extraction | `pip3 install pypdf` |
| ffmpeg | Joins audio segments and inserts pauses | `brew install ffmpeg` |
| Anthropic API key | Cleans the text and writes the scripts | <https://console.anthropic.com> |
| ElevenLabs API key | Generates the speech | <https://elevenlabs.io> |

ElevenLabs bills by character. A full book in a script mode uses a large share of a monthly quota, and a request fails with `quota_exceeded` when the quota runs out.

## Installation

```bash
git clone https://github.com/artful-chaos-engineering/Project-PDF2Audiobook.git
cd Project-PDF2Audiobook

npm install
pip3 install pypdf
brew install ffmpeg

cp .env.example .env
```

Edit `.env` and set your keys:

```bash
ELEVENLABS_API_KEY=your_elevenlabs_key
ANTHROPIC_API_KEY=your_anthropic_key
```

Optional paths in `.env`:

```bash
AUDIOBOOK_INPUT_DIR=/path/to/input    # default: ./input
AUDIOBOOK_OUTPUT_DIR=/path/to/output  # default: ./output
```

Create the input folder if it doesn't exist, and put the PDF in it:

```bash
mkdir -p input
cp ~/Downloads/your-book.pdf input/
```

Check the setup before a long run:

```bash
npx tsc --noEmit    # should finish with no output
ffmpeg -version | head -1
python3 -c "import pypdf; print('pypdf', pypdf.__version__)"
```

## Usage

### Command line

```bash
./run_app.sh                          # narration, all PDFs in input/
./run_app.sh technical-podcast        # positional mode
./run_app.sh --mode managerial-summary --input ./input --output ./output
./run_app.sh --help
```

| Option | Meaning |
|---|---|
| `-m, --mode MODE` | Output mode (see the table below). Default: `narration` |
| `-i, --input DIR` | Folder with PDFs. Default: `./input` |
| `-o, --output DIR` | Folder for the MP3 files. Default: `./output` |
| `-h, --help` | Show usage |

The same settings can be given as the environment variables `AUDIOBOOK_MODE`, `AUDIOBOOK_INPUT_DIR` and `AUDIOBOOK_OUTPUT_DIR`. Command-line options take precedence.

### Web app

```bash
./run_webapp.sh          # starts the server on port 3000 and opens the browser
PORT=3100 ./run_webapp.sh
./run_webapp.sh --stop   # stops the server on the port
```

Choose a file and a mode, then press Convert. Keep the tab open until the audio is ready. The app runs one conversion at a time.

## Modes

| Mode | What you get |
|---|---|
| `narration` | The text read in order. Presenters alternate by paragraph. |
| `podcast` | A two-host conversation about each section. |
| `debate` | One host argues the text's claims; the other challenges them. |
| `summary` | A spoken summary of each section. One voice. |
| `technical-podcast`, `technical-debate`, `technical-deep-dive`, `technical-summary` | As above, aimed at engineers. Keeps the specific mechanisms, terms and numbers. |
| `managerial-podcast`, `managerial-debate`, `managerial-deep-dive`, `managerial-summary` | As above, aimed at managers. Focuses on decisions, costs, risks and actions in plain language. |

A deep dive is a longer two-host walk through each idea, step by step.

Every script mode opens with a short introduction and closes with a recap and one question for the listener.

## Output

Each run writes one MP3 per input PDF, named for its mode:

```
output/<pdf-name>-<mode>.mp3
```

For example, `output/book-technical-podcast.mp3`.

## How it works

1. **Extract.** `pdfExtractor.ts` runs `pypdf` on each page and collects the text.
2. **Split.** `smartCleaner.ts` splits the text at numbered headings into sections of up to about 12,000 characters.
3. **Clean.** Claude removes the non-narrative material listed above and keeps every narrative sentence.
4. **Script.** `modes.ts` turns each section into a narration segment list, or asks Claude for a two-host script or a summary. Script modes add an introduction and a closing.
5. **Speak.** `ttsConverter.ts` sends each segment to ElevenLabs with its own voice and speed. Pauses come from a normal distribution: longer after headings and between speakers, shorter within one speaker's turns.
6. **Join.** ffmpeg joins the segments with the pauses and writes the MP3.

## Project layout

```
run_app.sh               command-line launcher
run_webapp.sh            web app launcher
src/
├── generate-with-elevenlabs.ts  entry point for run_app.sh
├── webapp.ts            local web server and upload page
├── processPdf.ts        runs one PDF through the pipeline
├── pdfExtractor.ts      PDF text extraction (pypdf)
├── smartCleaner.ts      section splitting and Claude cleaning
├── modes.ts             mode definitions, scripts, pacing
├── ttsConverter.ts      ElevenLabs calls and ffmpeg joining
├── config.ts            input and output folders
└── types.ts             shared types
input/                   your PDFs (not committed)
output/                  generated MP3s (not committed)
```

## Troubleshooting

- **`ANTHROPIC_API_KEY is not set`** or **`ELEVENLABS_API_KEY is not set`**: check `.env` and that you're running from the project folder.
- **`ffmpeg not found`**: `brew install ffmpeg`.
- **`npx not found`**: install Node.js.
- **`pypdf` import error**: `pip3 install pypdf`, using the same `python3` the shell runs.
- **`quota_exceeded`**: the ElevenLabs quota is used up. Wait for it to reset or add credits; the run stops with an error and writes no partial file.
- **`Stream has ended unexpectedly`**: the PDF is damaged or not a PDF. Re-download it or re-export it.
- **Web app says a conversion is already running**: wait for the first one to finish, or stop the server with `./run_webapp.sh --stop`.

## Development

```bash
npx tsc --noEmit         # type-check
./run_app.sh --help      # check the launcher without spending API credits
```

## License

MIT. See [LICENSE](LICENSE).
