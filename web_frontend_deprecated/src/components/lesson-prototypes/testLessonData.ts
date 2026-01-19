// web_frontend/src/components/lesson-prototypes/testLessonData.ts

import type { PrototypeLesson } from "./shared/types";

export const testLesson: PrototypeLesson = {
  title: "Introduction to AI Safety",
  blocks: [
    {
      type: "markdown",
      id: "intro",
      content: `# Why AI Safety Matters

Artificial intelligence is advancing rapidly. As AI systems become more capable, ensuring they remain safe and beneficial becomes increasingly important.

## A Brief History

The field of artificial intelligence began in the 1950s with pioneers like Alan Turing, John McCarthy, and Marvin Minsky. Early AI research focused on symbolic reasoning and expert systems - programs that could follow logical rules to solve problems.

For decades, progress was slow. AI went through several "winters" where funding dried up and interest waned. But the 2010s brought a revolution: deep learning. Neural networks, trained on massive datasets using powerful GPUs, achieved breakthroughs in image recognition, speech processing, and game playing.

In 2016, DeepMind's AlphaGo defeated the world champion at Go, a game long thought to require human intuition. In 2022, large language models like GPT demonstrated surprising abilities in writing, coding, and reasoning.

## Why Safety Matters Now

As AI systems become more capable, the stakes increase. A chess-playing AI that makes a mistake loses a game. A self-driving car AI that makes a mistake could harm passengers. An AI managing critical infrastructure could cause widespread disruption.

More fundamentally, as AI systems take on more complex tasks, we need to ensure they pursue goals aligned with human values. This is harder than it sounds - specifying exactly what we want is surprisingly difficult.

Consider a simple example: you might ask an AI to "maximize user engagement" on a social media platform. Without careful constraints, it might learn to promote outrage and misinformation because those generate more clicks.

## The Current Landscape

Today, AI safety research spans several areas:

**Alignment research** focuses on ensuring AI systems do what we actually want, not just what we literally asked for. This includes work on reward modeling, constitutional AI, and debate-based training.

**Interpretability research** aims to understand what's happening inside neural networks. If we can't understand why a model makes certain decisions, it's hard to trust it with important tasks.

**Robustness research** ensures AI systems behave reliably even in unusual situations or when facing adversarial inputs designed to confuse them.

**Governance research** examines policies, regulations, and international coordination needed to ensure AI development benefits humanity.

Now let's watch a video that explores these ideas further.`,
    },
    {
      type: "video",
      id: "video-1",
      videoId: "pYXy-A4siMw",
      start: 0,
      end: 300,
    },
    {
      type: "markdown",
      id: "section-1",
      content: `## Section 1: Understanding Intelligence

Intelligence is not a single trait but a collection of capabilities that allow organisms to solve problems, adapt to new situations, and achieve goals in complex environments.

When we talk about artificial intelligence, we're attempting to replicate or simulate these capabilities in machines. This is a fundamentally different approach than traditional programming, where we specify exact rules for the computer to follow.

Machine learning systems learn patterns from data rather than following explicit instructions. This gives them flexibility but also introduces new challenges around ensuring they learn what we actually want them to learn.

The field of AI safety emerged from the recognition that as these systems become more capable, the stakes of getting them right increase dramatically.`,
    },
    {
      type: "chat",
      id: "chat-1",
      prompt: "What stood out to you so far?",
    },
    {
      type: "markdown",
      id: "section-2",
      content: `## Section 2: The Scale of Intelligence

Human intelligence emerged through millions of years of evolution. Our brains contain roughly 86 billion neurons, each connected to thousands of others, forming an incredibly complex network.

Modern AI systems, while impressive, work very differently from biological intelligence. They excel at specific tasks but lack the general-purpose reasoning that humans take for granted.

However, the gap is narrowing. Recent advances in large language models and other AI architectures have demonstrated capabilities that surprised even their creators.

This rapid progress raises important questions about how we ensure these systems remain beneficial as they become more powerful. The window for addressing safety concerns may be shorter than many people realize.

Researchers are working on techniques like interpretability (understanding what AI systems are actually doing internally), alignment (ensuring AI goals match human values), and robustness (making systems behave reliably even in unusual situations).`,
    },
    {
      type: "chat",
      id: "chat-2",
      prompt: "How does this change your understanding of AI capabilities?",
    },
    {
      type: "markdown",
      id: "section-3",
      content: `## Section 3: The Alignment Problem

The **alignment problem** refers to the challenge of ensuring AI systems pursue goals that align with human values and intentions. This is surprisingly difficult because specifying goals precisely is hard, and AI systems may find unexpected ways to achieve objectives that technically satisfy their goals while violating our intentions.

Consider a simple example: you might ask an AI to "make people happy." But how do you prevent it from achieving this by manipulating brain chemistry directly, rather than by genuinely improving people's lives?

**Capability vs. control** is a central tension in AI development. As systems become more capable, they become more useful but also potentially more dangerous if not properly controlled. Finding the right balance requires careful research and engineering.

**The importance of timing** cannot be overstated. Safety work needs to happen before powerful AI systems are deployed, not after. Once a system is in widespread use, it becomes much harder to address fundamental safety issues.`,
    },
    {
      type: "markdown",
      id: "conclusion",
      content: `## Key Takeaways

Looking ahead, the field of AI safety encompasses many active research areas including:

- **Interpretability**: Understanding what AI systems are actually learning and how they make decisions
- **Alignment**: Developing techniques to ensure AI goals match human values
- **Robustness**: Making systems behave reliably even in unusual or adversarial conditions
- **Governance**: Creating policies and institutions to manage AI development responsibly

In the next lesson, we'll explore specific approaches researchers are taking to address these challenges and how you can contribute to this important work.`,
    },
    {
      type: "chat",
      id: "chat-3",
      prompt: "What questions do you still have about AI safety?",
    },
  ],
};
