# Content Filtering Algorithm

This document explains how the PDF2Audiobook converter identifies and filters different content types.

## Overview

The converter processes each PDF page and identifies content elements using pattern matching and heuristics. Non-narrative content is either removed or summarized to maintain natural reading flow.

## Content Types Identified

### 1. Body Text (Kept)
**Purpose:** Core narrative content to be converted to speech

**Detection:**
- Text that isn't identified as any other type
- Multiple lines grouped together
- Contains complete sentences

**Example:**
```
Machine learning has revolutionized many industries.
From healthcare to finance, AI systems now power
critical decision-making processes.
```

### 2. Headings (Kept)
**Purpose:** Section and chapter markers

**Detection patterns:**
- All uppercase words: `CHAPTER 1`, `INTRODUCTION`
- Numbered format: `1. Getting Started`
- Markdown headers: `# Title`
- Length: 3-150 characters

**Example:**
```
MACHINE LEARNING FUNDAMENTALS
```

**Heading levels:**
- Level 1: Short headings (< 30 chars)
- Level 2: Medium headings (30-60 chars)
- Level 3: Longer headings (> 60 chars)

### 3. Tables (Filtered → Summarized)
**Purpose:** Data tables - removed but summarized

**Detection patterns:**
- Multiple columns separated by 2+ spaces or tabs
- Lines with alternating text and numbers
- Format: `Label     Value     Percentage`

**Summarization:**
- Extracts column headers
- Detects data types (numeric, percentage, text)
- Generates 1-sentence summary

**Example Input:**
```
Algorithm    Accuracy   Speed
Neural Net   94.5%      Fast
Decision Tree 87.2%     Slow
```

**Example Output:**
```
Table 3 shows a comparison table with 3 columns including: 
Algorithm, Accuracy, Speed
```

### 4. Figures (Filtered → Summarized)
**Purpose:** Images and diagrams - removed but referenced

**Detection patterns:**
- Starts with "Figure" or "Fig."
- Followed by number: `Figure 1:`, `Fig. 2.3`
- Contains optional caption

**Summarization:**
- Extracts figure number
- Extracts figure title if present
- Generates descriptive summary

**Example Input:**
```
Figure 1: Architecture diagram showing data flow from 
input layer through hidden layers to output layer
```

**Example Output:**
```
Figure 1 titled "Architecture diagram showing data flow 
from input layer through hidden layers to output layer" 
shows the neural network structure.
```

### 5. Headers (Filtered)
**Purpose:** Running headers at top of pages - removed

**Detection patterns:**
- Length < 100 characters
- Matches patterns like:
  - `Chapter 5`
  - `TOPIC    PAGE_NUMBER` (aligned right)
  - Single uppercase phrases

**Example:**
```
Introduction to Neural Networks
```

### 6. Footers (Filtered)
**Purpose:** Page numbers and publication info - removed

**Detection patterns:**
- Length < 80 characters
- Page numbers: `Page 45` or just `45`
- Copyright: `© 2024`
- URLs: `www.example.com`

**Example:**
```
45
```

### 7. Table of Contents (Filtered)
**Purpose:** Navigation aid - removed (narrative doesn't need it)

**Detection patterns:**
- Starts with: `Table of Contents`, `Contents`, `TOC`
- Often at beginning of book
- Contains chapter/section listings

**Example:**
```
Table of Contents
1. Introduction .......................... 1
2. Fundamentals .......................... 10
```

### 8. References (Filtered)
**Purpose:** Citation list - removed (not part of main narrative)

**Detection patterns:**
- Section header: `References`, `Bibliography`, `Works Cited`
- Citation format: `[1] Author, et al.`
- Academic citations

**Example:**
```
[1] Smith, J., & Jones, A. (2023). Machine Learning Basics.
[2] Brown, M. (2023). Deep Learning Advances.
```

### 9. Glossary (Filtered)
**Purpose:** Term definitions - removed (breaks narrative flow)

**Detection patterns:**
- Section header: `Glossary`, `Appendix`, `Definitions`
- Term definition format: `Term: Definition`

**Example:**
```
Algorithm: Step-by-step procedure for solving a problem
Neural Network: Computational model inspired by biological neurons
```

## Filtering Logic

```
For each content element:
1. Check if it matches a specific type
2. If it's narrative (body or heading): KEEP
3. If it's a table/figure: SUMMARIZE and INSERT
4. If it's header/footer/TOC/references/glossary: REMOVE
5. Merge consecutive narrative elements
6. Insert table/figure summaries at appropriate points
```

## Insertion Points

Table and figure summaries are inserted:
- Near where they appear in the PDF
- After the paragraph that references them
- Formatted naturally into the narrative

**Example:**
```
This approach has three main advantages.

Table 1 shows a comparison with 3 columns: Method, Speed, Accuracy

First, it's faster than traditional methods.
```

## Edge Cases

### Mixed Headers
If a line could be both heading and body:
```
Chapter 1: Introduction to Machine Learning
```
→ Treated as heading (starts with number pattern)

### Short Headings
If text is ALL CAPS but only 2-3 chars:
```
PDF
```
→ Treated as body (too short to be heading)

### Table-Like Lists
If text has spacing but isn't a table:
```
This is important: pay attention here
```
→ Treated as body (not enough columns)

## Performance

- Single-pass processing per page
- O(n) complexity where n = page text length
- Regex-based pattern matching for speed
- No external dependencies for filtering

## Tuning

To adjust filtering behavior, modify detection patterns in `pdfExtractor.ts`:

- Change length thresholds
- Add/remove patterns
- Adjust regex expressions
- Modify heading level calculation

Example: To be stricter on headers:
```typescript
private isHeading(text: string): boolean {
  const trimmed = text.trim();
  // Require minimum 4 words for heading
  return trimmed.split(/\s+/).length >= 4 && /^[A-Z]/.test(trimmed);
}
```
