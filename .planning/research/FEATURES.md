# Feature Landscape: AI Roleplay Practice Conversations

**Domain:** Multi-turn AI roleplay conversations in AI Safety education
**Researched:** 2026-02-24

## Table Stakes

Features required for roleplay to function. Missing = feels broken or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Multi-turn streaming conversation | Core interaction. User sends message, AI responds in character with SSE streaming. Back-and-forth dialogue. | Low | Reuses existing `stream_chat()` + SSE + `NarrativeChatSection` pattern. New system prompt assembly needed. |
| Character persona via instructions | Content authors define who the AI is playing via `instructions::` field | Low | Follows existing `## Chat` instructions pattern. Content drives persona. |
| Character name display | Users must know who they're talking to (not "Tutor"). Distinct visual identity from tutor chat. | Low | New `character::` field or extracted from instructions. Character name in header, colored border/tint. |
| Voice input | Already exists for questions and chat. Omitting it from roleplay would feel inconsistent. Natural for conversation practice. | Low | Direct reuse of `useVoiceRecording` hook. No new backend work. |
| Text input | Not all users can or want to use voice. Text must always work. | Low | Already built into `NarrativeChatSection`. |
| Message count end trigger | Most predictable ending mechanism. Prevents runaway conversations. Course creators set the number. | Low | Backend/frontend counts user messages. After N messages, conversation ends. |
| Conversation persistence | Users may leave and return. State must survive page refresh. | Low | Reuse existing `chat_sessions` table with a new `content_type` (e.g., "roleplay"). |
| Content parsing (segment type) | Content authors must be able to write `## Roleplay` segments in markdown | Low | Follows established `## Question` / `## Chat` pattern. New entry in SEGMENT_SCHEMAS. |
| Integration into section types | Roleplay works in page, lens-article, lens-video sections | Low | Same section compatibility as question and chat segments. |
| Inside test sections | Roleplay can be an assessable item in tests when paired with assessment | Med | TestSection must handle non-question segment types. |
| End-of-conversation state | After conversation ends, clear visual indication. Input disabled. | Low | Similar to AnswerBox completed state. "Conversation complete" banner. |

## Differentiators

Features that make roleplay pedagogically valuable, not just functional.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI assessment of dialogue quality | Course creators define rubric via `assessment-instructions::`. After conversation ends, AI evaluates student performance across dimensions. | Med | Extends existing `scoring.py` pattern. Structured output with overall_score, dimensions, key_observations. Input is full transcript instead of single answer. |
| AI-monitored end trigger | AI naturally concludes conversation when scenario goals are met. Most natural ending. | Med | Reuses `TRANSITION_TOOL` pattern from `chat.py`. AI calls `end_conversation` tool. Must include safety valve (hard cap at ~20 messages). |
| Time-based end trigger | Limits conversation duration for timed exercises. Simulates real-world time pressure. | Low | Frontend timer. Countdown displayed. Warning at 1 min remaining. |
| Opening message (AI greeting) | Character introduces themselves, sets the scene, starts the conversation naturally | Low | Optional `opening-message::` field. AI sends first message. Reduces blank-page anxiety. |
| Scenario context briefing | Before conversation starts, display scenario card describing the situation | Low | Authored in content markdown. Displayed above conversation before first message. |
| Post-conversation feedback chat | After assessment, student discusses performance with AI in reflective mode | Med | Reuses `feedback.py` pattern. Receives conversation transcript + assessment results as context. |
| Previous content context | Character can reference article/video student just saw | Low | Existing `gather_section_context()` already provides this for chat segments. |
| End trigger UI indicator | Show messages remaining or time remaining during conversation | Low | Frontend display. "3 messages remaining" or countdown timer. |
| Multiple attempts | Student can retry the roleplay to practice different approaches | Low | Archive current session, create new one. "Try again" button. Same pattern as question "Answer again". |
| Assessment in test context | Roleplay scores contribute to test section completion | Med | TestSection + scoring pipeline integration. Depends on assessment feature. |
| Configurable end trigger types | Course creators choose which trigger via `end-trigger::` field (messages:N, time:Nm, ai-monitored) | Med | Content markdown field parsed into structured config. |

## Anti-Features

Features to explicitly NOT build. Tempting but wrong for this use case.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time voice conversation (speech-to-speech) | Massive complexity: WebRTC, real-time TTS, voice activity detection, latency management. The record-then-transcribe flow is dramatically simpler. | Keep existing voice input (record -> transcribe -> send as text). Text-based AI responses. Students practice articulation through recording. |
| Multiple AI characters in one conversation | Multi-agent conversations are an order of magnitude more complex (turn management, who speaks when, maintaining multiple persona states). | One character per roleplay segment. Course creators sequence multiple segments for multi-character scenarios. |
| Student avatar/persona assignment | Telling students "you are playing X role" adds confusion. The student IS the student. | Student is always themselves. Scenario describes the situation, not a role for the student. |
| Branching narrative trees | Pre-authored branching paths are brittle, expensive to create, and inferior to LLM-driven adaptive conversation. | Let the LLM drive conversation flow based on character instructions. AI adapts naturally. |
| Gamification / scoring leaderboards | Competitive scoring of subjective conversation skills creates anxiety and gaming behavior. Contradicts safe practice space. | Assessment is formative, not competitive. Scores visible only to the student. No rankings. |
| Real-time typing indicators for AI | "Character is typing..." adds latency feel without value. Streaming text already shows AI is responding. | Stream tokens directly as they arrive (existing pattern). |
| Custom character avatars/images | Content authoring complexity for minimal learning value. Character identity conveyed through name and dialogue style. | Character name + one-line description in header. Optionally a colored icon/initial. |
| Text-to-speech for AI responses | Adds latency, cost, and API complexity. Text responses are sufficient for practice. | Display text responses only. TTS is a separate future feature. |
| Conversation replay/review feature | Complex UI for re-reading completed conversations with annotations. | Chat session messages are already persisted. A review feature is separate work. |
| Roleplay-specific analytics | Track roleplay completion rates, average duration, etc. | Existing progress tracking covers completion. Detailed analytics is separate. |

## Feature Dependencies

```
Content Parsing (## Roleplay segment type)
  |
  +---> Backend: Roleplay Prompt Assembly (core/modules/roleplay.py)
  |       |
  |       +---> End-Condition Detection
  |       |       |
  |       |       +---> Message count (simplest)
  |       |       +---> Time limit (frontend timer)
  |       |       +---> AI-monitored (tool-calling, needs safety valve)
  |       |       |
  |       |       +---> SSE Event: roleplay_end
  |       |
  |       +---> Opening Message Support
  |       |
  |       +---> Previous Content Context (gather_section_context)
  |
  +---> Frontend: RoleplayBox Component
          |
          +---> Character Name Display + Scenario Briefing
          |
          +---> Voice Input (reuses useVoiceRecording)
          |
          +---> End-Condition UI Indicator
          |
          +---> Completed State
                  |
                  +---> Assessment Scoring (scoring.py with transcript)
                  |       |
                  |       +---> Post-conversation feedback chat
                  |
                  +---> Multiple Attempts ("Try again")
                  |
                  +---> TestSection Integration (roleplay as assessable item)
```

**Key dependency insight:** Content parsing unblocks everything. Backend and frontend proceed in parallel once types are defined. Assessment builds on completed conversations and is independently deferrable.

## Detailed Analysis: Conversation End Triggers

The most novel design decision. Three approaches, each for different scenarios:

### 1. Message Count (`end-trigger:: messages:10`)
- **How it works:** Count user messages. After N, conversation ends.
- **Pros:** Dead simple. Predictable. Course creators know exact duration.
- **Cons:** Feels abrupt. May end mid-thought. No adaptation to quality.
- **Best for:** Warm-up exercises, time-constrained test scenarios.
- **Implementation:** Backend/frontend counter. After Nth user message + AI response, trigger end state. AI gets a "this is your final response, wrap up naturally" instruction on the last turn.

### 2. Time Limit (`end-trigger:: time:5m`)
- **How it works:** Timer starts when conversation begins. Warning at 1 min remaining. Auto-end at limit.
- **Pros:** Simulates real-world time pressure. Consistent experience duration.
- **Cons:** Fast typers get more turns. Time pressure may increase anxiety.
- **Best for:** Timed practice, simulating real encounters with natural time constraints.
- **Implementation:** Frontend timer. Countdown displayed. Same wrap-up flow as message count.

### 3. AI-Monitored (`end-trigger:: ai-monitored`)
- **How it works:** AI has access to `end_conversation` tool. System prompt includes scenario goals. AI calls tool when goals are met.
- **Pros:** Most natural ending. Adapts to conversation flow. Can end early if student excels.
- **Cons:** Unpredictable duration. AI may end too early or never. Requires safety valve.
- **Best for:** Open-ended practice, scenarios where "convincing the character" IS the goal.
- **Implementation:** Extends `TRANSITION_TOOL` pattern from `chat.py`. Must include safety valve (hard cap ~20 messages or ~10 minutes).

**Recommendation:** Implement message count first (simplest, most predictable). Add AI-monitored second (highest pedagogical value, builds on existing tool-calling). Time limit third (less common use case). All three must include a safety valve maximum.

## Detailed Analysis: Assessment of Roleplay Conversations

### How It Differs from Question Assessment

- **Questions:** Single text answer assessed against a rubric.
- **Roleplay:** Full conversation transcript (5-20 exchanges) assessed against scenario-specific criteria. More context, more dimensions, more nuance.

### Assessment Dimensions (from domain research)

Educational AI conversation assessment typically evaluates:

1. **Content accuracy** - Did the student convey correct information?
2. **Persuasiveness** - Did they make compelling arguments adapted to the audience?
3. **Empathy / Active listening** - Did they acknowledge the character's perspective?
4. **Adaptiveness** - Did they adjust their approach based on responses?
5. **Conversation management** - Did they stay on topic, ask good questions, build rapport?

For AI safety specifically:
- Accuracy of AI safety concepts explained
- Ability to address common objections without being dismissive
- Use of concrete examples rather than abstract jargon (per CAIS communication guidelines: replace "existential risk" with "human extinction", "AI alignment" with "keeping AIs under human control")
- Calibrated urgency (neither dismissive nor alarmist)

### Assessment Architecture

Adapts existing `scoring.py` pattern:

1. **Trigger:** Conversation ends (any trigger type).
2. **Input:** Full transcript + `assessment-instructions::` from content.
3. **Scoring prompt:** System includes character description, scenario goals, rubric. User message includes formatted transcript.
4. **Output:** Same structured output (overall_score, reasoning, dimensions, key_observations).
5. **Storage:** Extend `question_assessments` or new table linked to chat_session_id.

**Confidence:** MEDIUM. Pattern works, but tuning multi-turn dialogue assessment is harder than single-answer scoring. Quality depends heavily on course creators writing good `assessment-instructions`.

## MVP Recommendation

Prioritize:
1. **Content parsing + types** -- Unblocks everything else
2. **Roleplay prompt assembly** -- Backend must handle character personas
3. **RoleplayBox with message count end trigger** -- Simplest end trigger, proves full loop
4. **Voice input in RoleplayBox** -- Reuses existing hook, high pedagogical value
5. **Scenario briefing + character display** -- Low complexity, high UX value

Defer:
- **AI-monitored end trigger:** More complex; add after basic flow works
- **Time-based end trigger:** Less common; add after message count works
- **Assessment scoring:** High value but not blocking core experience; second phase
- **Opening message:** Nice-to-have; conversation can start with student speaking first
- **TestSection integration:** Depends on assessment; build after standalone works
- **Post-conversation feedback:** Depends on assessment; second phase
- **End-condition UI indicators:** Functional without visual indicators; add in polish phase

## Proposed Content Markdown Design

Based on existing segment patterns (`## Chat`, `## Question`, `## Text`):

```markdown
## Roleplay
character:: Sarah Chen, Tech CEO
instructions::
You are Sarah Chen, CTO of a mid-size tech company. You're at a dinner party
and someone (the student) brings up AI safety. You're skeptical -- you think
current AI systems are just tools and the "existential risk" framing is
overblown science fiction. You're open to good arguments but need concrete
evidence, not hand-waving about hypothetical superintelligence.

Your personality: Direct, data-driven, slightly impatient with vague claims.
You respect technical competence. You'll push back on weak arguments but
acknowledge strong ones.

Goals for this conversation: The student should try to explain why AI safety
research matters, addressing your specific objections rather than giving a
generic pitch.

end-trigger:: messages:8
assessment-instructions::
Evaluate the student's conversation on these dimensions:
1. Technical accuracy (1-5): Did they accurately represent AI safety concepts?
2. Persuasiveness (1-5): Did they tailor arguments to Sarah's perspective?
3. Active listening (1-5): Did they address Sarah's specific objections?
4. Use of examples (1-5): Did they use concrete examples rather than abstract claims?
```

This follows established patterns. New fields for `SEGMENT_SCHEMAS` in `content-schema.ts`:
- `instructions` (required) -- character persona and scenario
- `character` (required) -- display name for the character
- `end-trigger` (optional, defaults to `messages:8`)
- `assessment-instructions` (optional) -- rubric for AI assessment
- `opening-message` (optional) -- AI's first message
- `optional` (optional boolean)

## Sources

- [Jenova AI - AI Persona Roleplay](https://www.jenova.ai/en/resources/ai-persona-roleplay) - Market overview; 80-90% completion rates for AI roleplay vs 15-20% for traditional eLearning
- [Noodle Dialogue](https://about.noodle.com/products/dialogue/) - LMS-integrated conversation practice with rubric scoring
- [VirtualSpeech AI Practice](https://virtualspeech.com/ai-practice) - Three-stage pattern: practice -> feedback -> reflect with AI coach
- [Yoodli AI Roleplays](https://yoodli.ai/) - Customizable conversation partners, "Stop" button to end, post-call analytics
- [EDUCAUSE - Dialogue at Scale](https://er.educause.edu/articles/2025/10/dialogue-at-scale-ai-soft-skills-and-the-future-of-assessment) - AI dialogue-based assessment of soft skills at scale
- [Duolingo Max](https://blog.duolingo.com/duolingo-max/) - Scenario-based roleplay; experts write initial prompts + scenario goals; AI-powered feedback on accuracy and complexity
- [CAIS - How to Talk About AI Safety](https://safe.ai/act/talk) - Communication strategies: replace jargon, start with shared values, use concrete examples
- [GitHub - Awesome LLM Role-Playing](https://github.com/Neph0s/awesome-llm-role-playing-with-persona) - Research survey; persona consistency and termination detection patterns
- [LLM Role-Playing Conversations (Medium)](https://leonnicholls.medium.com/llm-role-playing-conversations-a1dba626eceb) - Multi-role conversation management, termination token approach
- [AI-driven vs human evaluations (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2451958825003252) - AI assessment reliability comparable to trained human assessors for empathy ratings
- [elearningtrendz - AI Roleplay Software Features](https://www.elearningtrendz.com/blog/best-ai-roleplay-software-for-training-key-features-you-should-look-for/) - Feature checklist: no-code authoring, content libraries, analytics
- Existing codebase analysis: `core/modules/chat.py` (TRANSITION_TOOL pattern), `core/scoring.py` (assessment pipeline), `core/modules/feedback.py` (post-assessment feedback), `content_processor/src/content-schema.ts` (SEGMENT_SCHEMAS), `web_frontend/src/hooks/useVoiceRecording.ts`, `web_frontend/src/components/module/NarrativeChatSection.tsx`, `web_frontend/src/components/module/AnswerBox.tsx`
