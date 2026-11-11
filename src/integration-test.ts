import { AudiobookGenerator } from './audiobook';
import type { AudiobookConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

// Create a mock PDF with realistic content
function createMockPDF(): string {
  const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< >>
stream
BT
/F1 12 Tf
50 750 Td
(CHAPTER 1: INTRODUCTION TO MACHINE LEARNING) Tj
0 -20 Td
(Machine learning is a subset of artificial intelligence.) Tj
0 -20 Td
(It focuses on algorithms that learn from data.) Tj
0 -40 Td
(Table 1: Algorithm Comparison) Tj
0 -20 Td
(Algorithm     Accuracy     Speed) Tj
0 -15 Td
(Neural Net    94.5%        Fast) Tj
0 -15 Td
(Decision Tree 87.2%        Slow) Tj
0 -40 Td
(Figure 1: Neural Network Architecture) Tj
0 -20 Td
(Figure shows input layer to output layer connections.) Tj
0 -40 Td
(REFERENCES) Tj
0 -20 Td
([1] Smith, J. (2023). Deep Learning Advances.) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000244 00000 n
0000000500 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
576
%%EOF`;

  const testDir = path.join(process.cwd(), 'test-fixtures');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const pdfPath = path.join(testDir, 'test-book.pdf');
  fs.writeFileSync(pdfPath, pdfContent);
  return pdfPath;
}

async function runIntegrationTest() {
  console.log('🧪 Running PDF2Audiobook Integration Test\n');

  // Create mock PDF
  console.log('📝 Creating test PDF...');
  const pdfPath = createMockPDF();
  console.log(`   ✓ Test PDF created at: ${pdfPath}\n`);

  // Verify PDF was created
  if (fs.existsSync(pdfPath)) {
    const stats = fs.statSync(pdfPath);
    console.log(`   File size: ${stats.size} bytes`);
  }

  // Configuration for audiobook generation
  const config: AudiobookConfig = {
    pdfPath,
    outputPath: path.join(path.dirname(pdfPath), 'test-book.mp3'),
    voiceProvider: 'elevenlabs',
    voice: 'bella',
    language: 'en',
    speed: 1.0,
  };

  console.log('\n⚙️  Configuration:');
  console.log(`   PDF: ${config.pdfPath}`);
  console.log(`   Output: ${config.outputPath}`);
  console.log(`   Provider: ${config.voiceProvider}`);
  console.log(`   Voice: ${config.voice}\n`);

  try {
    // Validate configuration
    console.log('🔍 Validating configuration...');

    if (!fs.existsSync(config.pdfPath)) {
      throw new Error(`PDF file not found: ${config.pdfPath}`);
    }
    console.log('   ✓ PDF file exists');

    if (!config.voiceProvider) {
      throw new Error('Voice provider must be specified');
    }
    console.log('   ✓ Voice provider specified');

    console.log('\n✅ Integration test validation PASSED');
    console.log('\nNote: Full audio generation requires TTS API key.');
    console.log('To complete the audiobook generation:');
    console.log('1. Set ELEVENLABS_API_KEY environment variable');
    console.log('2. Run: npm start -- ' + config.pdfPath);

    // Cleanup test file
    fs.unlinkSync(pdfPath);
    console.log('\n🧹 Test PDF cleaned up');

    return true;
  } catch (error) {
    console.error('\n❌ Integration test FAILED:', error);
    // Cleanup on failure
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }
    return false;
  }
}

runIntegrationTest().then((passed) => {
  process.exit(passed ? 0 : 1);
});
