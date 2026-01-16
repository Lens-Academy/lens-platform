// web_frontend/src/components/lesson-prototypes/prototype-e/testLessonE.ts

import type { PrototypeLesson } from "../shared/types";

// Test lesson with multiple video slots - the same video appears multiple times
// but it's the SAME instance traveling between positions
export const testLessonE: PrototypeLesson = {
  title: "Traveling Video Demo",
  blocks: [
    {
      type: "markdown",
      id: "intro",
      content: `# The Traveling Video Pattern

This prototype demonstrates a single video instance that "travels" between different positions on the page as you scroll.

**Watch how the video moves** - it's the same player instance, maintaining its playback state.`,
    },
    {
      type: "video",
      id: "video-slot-1",
      videoId: "pYXy-A4siMw",
      start: 0,
      end: 60,
    },
    {
      type: "chat",
      id: "chat-1",
      prompt: "What do you notice about how the video behaves as you scroll?",
    },
    {
      type: "markdown",
      id: "section-1",
      content: `## Section 1: Understanding Intelligence

Scroll down and notice how the video follows you...

Intelligence is not a single trait but a collection of capabilities that allow organisms to solve problems, adapt to new situations, and achieve goals in complex environments.

When we talk about artificial intelligence, we're attempting to replicate or simulate these capabilities in machines.`,
    },
    {
      type: "video",
      id: "video-slot-2",
      videoId: "pYXy-A4siMw",
      start: 60,
      end: 120,
    },
    {
      type: "chat",
      id: "chat-2",
      prompt: "The video maintained its position! What implications does this have for learning experiences?",
    },
    {
      type: "markdown",
      id: "section-2",
      content: `## Section 2: The Scale of Intelligence

Keep scrolling - the video will follow again...

Human intelligence emerged through millions of years of evolution. Our brains contain roughly 86 billion neurons, each connected to thousands of others.

Modern AI systems, while impressive, work very differently from biological intelligence.`,
    },
    {
      type: "video",
      id: "video-slot-3",
      videoId: "pYXy-A4siMw",
      start: 120,
      end: 180,
    },
    {
      type: "markdown",
      id: "conclusion",
      content: `## Why This Pattern?

The traveling video pattern creates a sense of continuity - you're always working with the same content, just viewing it at different points in your learning journey.

This can be useful for:
- **Reference videos** that students return to multiple times
- **Long-form content** broken into digestible chunks
- **Interactive tutorials** where the same demonstration is discussed from different angles`,
    },
    {
      type: "chat",
      id: "chat-3",
      prompt: "What other use cases can you imagine for this pattern?",
    },
  ],
};
