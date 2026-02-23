# Feature Landscape: Prompt Lab Evaluation Workbench

**Domain:** LLM prompt evaluation tool for educational AI tutor and assessment scoring
**Researched:** 2026-02-20

## Table Stakes

Features facilitators expect. Missing = tool doesn't solve the core problem.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| System prompt editor | Core artifact being iterated on; every playground (Anthropic Console, OpenAI, Langfuse) puts this front and center | Low | Expose base prompt + instructions composition from `_build_system_prompt()` |
| Conversation fixture loading | Evaluation requires real student data; "replay production traces" is universal pattern | Low | Existing `chat_sessions` table + facilitator API already provides data |
| Regenerate at any point | Fundamental eval loop: "with my new prompt, what would AI say here?" | Medium | Slice conversation, pass truncated history + custom prompt to `stream_chat()` |
| Side-by-side comparison | Every serious eval tool shows original vs. regenerated | Medium | Two-column layout, need to store regenerated response separately |
| Interactive "play student" mode | Test edge cases beyond existing conversations | Low | Same as regeneration but continue appending messages |
| Assessment prompt editor + runner | Assessment-side equivalent of chat prompt editor | Medium | Depends on ws3's `complete()` and `SCORE_SCHEMA` |
| Chain-of-thought visibility | Facilitators need to see AI reasoning to validate scoring | Low | Render structured output fields (reasoning, dimensions, key_observations) |
| Human ground-truth comparison | Cannot know if AI scoring is correct without human reference | Medium | Scoring UI with comparison view against fixture's ground truth |

## Differentiators

Features that would elevate the tool but are not required for initial usefulness.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Conversation forking | Branch and explore alternate student paths ("what if student said X?") | High | Requires tree data structure for conversations; significant UI complexity |
| Prompt version history | Track every edit with diffs; prevent losing good prompts during experimentation | Medium | JSONB array of {timestamp, prompt_text} or localStorage |
| Annotation/notes on messages | "This response was too long," "Good Socratic questioning here" | Low | Simple annotation UI attached to message elements |
| Curated test suite | Mark 5-15 conversations as benchmarks; re-run against all when prompt changes | Medium | Batch regeneration + summary view |
| Model parameter controls | Adjust temperature, max_tokens in the playground | Low | LiteLLM already accepts these; UI is just sliders/inputs |
| Multi-model comparison | Same prompt against Claude Sonnet vs Haiku vs GPT-4o | Low | LiteLLM abstracts model selection; add model dropdown |
| Export/share results | Permalink or document for async team review | Low | JSON/Markdown export or shareable state URL |

## Anti-Features

Features to explicitly NOT build. Common in the prompt eval ecosystem but wrong for this use case.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automated metric scoring (BLEU, ROUGE) | Eval is qualitative; high embedding similarity does not mean pedagogically better | Human review with annotations at 5-15 conversations |
| CI/CD integration / regression testing | 5-15 curated conversations, 1-3 facilitators doing manual review; YAML configs + CI runners are overhead | "Curated test suite" differentiator (manual batch re-run) |
| Production A/B testing | Small cohorts make statistical testing meaningless; routing real students to experimental prompts is irresponsible | Manual review before deployment |
| LLM-as-a-judge evaluation | Adds indirection unnecessary when human domain experts review 5-15 conversations | Human scoring with ground-truth comparison |
| Prompt auto-optimization | Auto-optimized prompts may score better on metrics while losing pedagogical intent | Manual editing; facilitators are domain experts |
| Red teaming / security scanning | Controlled educational context with authenticated students; minimal attack surface | Basic guardrails in system prompt |
| Complex dataset management | At 5-15 conversations, a simple list with filter is sufficient | Simple fixture browser with module filter |

## Feature Dependencies

```
Conversation/Fixture Loading
         |
    +----+----+
    |         |
    v         v
System Prompt    Assessment Prompt
Editor           Editor + Runner
    |                |
    v                v
Response          Chain-of-Thought
Regeneration      Visibility
    |                |
    v                v
Side-by-Side     Human Ground-Truth
Comparison       Score Comparison
    |                |
    v                v
"Play Student"   [Assessment eval complete]
Mode
```

**Key dependency insight:** Chat eval and assessment eval are parallel tracks sharing only fixture infrastructure. Build chat eval first (no ws3 dependency), then assessment eval.

## MVP Recommendation

Prioritize:
1. **Fixture loading + System prompt editor** -- Minimum to be useful
2. **Response regeneration (streaming)** -- Core evaluation action
3. **Side-by-side comparison** -- Makes regeneration useful
4. **"Play student" mode** -- Low-cost addition once regeneration works
5. **Assessment prompt editor + runner + CoT visibility** -- Assessment eval track (Phase 2)
6. **Human ground-truth comparison** -- Completes assessment eval loop (Phase 2)

Defer:
- Conversation forking: High complexity, uncertain value
- Prompt version history: Nice but not critical initially
- Curated test suite: Useful after enough iteration to need regression protection
- Multi-model comparison: Low complexity but not the primary pain point

## Sources

- Anthropic Console Workbench: system prompt editing, regeneration, side-by-side
- OpenAI Prompts Playground: prompt versioning, comparison
- Langfuse Playground: prompt management, A/B testing, side-by-side comparison
- BrainTrust: human review, evaluation benchmarks, prompt variations
- Promptfoo: CI/CD integration, red teaming (excluded as anti-features)
- Direct codebase analysis: existing chat, scoring, and facilitator infrastructure
