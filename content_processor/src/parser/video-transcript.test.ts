// src/parser/video-transcript.test.ts
import { describe, it, expect } from 'vitest';
import { parseVideoTranscript } from './video-transcript.js';

describe('parseVideoTranscript', () => {
  it('parses valid transcript with all fields', () => {
    const content = `---
title: AI Safety Introduction
channel: Safety Channel
url: "https://www.youtube.com/watch?v=abc123"
---

0:00 - Welcome to AI safety.
1:00 - End of intro.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/intro.md');

    expect(result.errors).toHaveLength(0);
    expect(result.transcript).not.toBeNull();
    expect(result.transcript!.title).toBe('AI Safety Introduction');
    expect(result.transcript!.channel).toBe('Safety Channel');
    expect(result.transcript!.url).toBe('https://www.youtube.com/watch?v=abc123');
  });

  it('reports error for missing title', () => {
    const content = `---
channel: Test Channel
url: "https://example.com/video"
---

Transcript.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.some(e => e.message.toLowerCase().includes('title'))).toBe(true);
    expect(result.errors[0].severity).toBe('error');
  });

  it('reports error for missing channel', () => {
    const content = `---
title: Test
url: "https://example.com/video"
---

Transcript.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.some(e => e.message.toLowerCase().includes('channel'))).toBe(true);
  });

  it('reports error for missing url', () => {
    const content = `---
title: Test
channel: Test Channel
---

Transcript.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.some(e => e.message.toLowerCase().includes('url'))).toBe(true);
  });

  it('reports error for empty required fields', () => {
    const content = `---
title: ""
channel: "  "
url: "https://example.com"
---

Transcript.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.some(e => e.message.toLowerCase().includes('title'))).toBe(true);
    expect(result.errors.some(e => e.message.toLowerCase().includes('channel'))).toBe(true);
  });

  it('reports error when title contains a wikilink', () => {
    const content = `---
title: "[[Some Video]]"
channel: Test Channel
url: "https://example.com/video"
---

Transcript.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.some(e =>
      e.message.includes('title') && e.message.toLowerCase().includes('wikilink')
    )).toBe(true);
  });

  it('reports error when channel contains a wikilink', () => {
    const content = `---
title: Test
channel: "[[My Channel]]"
url: "https://example.com/video"
---

Transcript.
`;
    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.some(e =>
      e.message.includes('channel') && e.message.toLowerCase().includes('wikilink')
    )).toBe(true);
  });

  it('reports error for missing frontmatter', () => {
    const content = `Just a transcript without frontmatter.`;

    const result = parseVideoTranscript(content, 'video_transcripts/test.md');

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.transcript).toBeNull();
    expect(result.errors.some(e => e.message.toLowerCase().includes('frontmatter'))).toBe(true);
  });
});
