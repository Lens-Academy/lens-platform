# Narrative Lesson Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build backend API to serve narrative lessons with bundled content and position-aware chat.

**Architecture:** Add new dataclasses for narrative lesson structure, a loader to parse the YAML and extract content, and update the `/api/lessons/{slug}` endpoint to return the bundled response. Reuse existing session system with position-aware message endpoint.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, dataclasses, pytest

---

## Task 1: Add Narrative Lesson Types

**Files:**
- Modify: `core/lessons/types.py`

**Step 1: Add the new dataclasses**

Add these types after the existing `Stage` types:

```python
# --- Narrative Lesson Types ---

@dataclass
class TextSegment:
    """Standalone authored text."""
    type: Literal["text"]
    content: str


@dataclass
class ArticleExcerptSegment:
    """Extract from parent article."""
    type: Literal["article-excerpt"]
    from_text: str
    to_text: str


@dataclass
class VideoExcerptSegment:
    """Extract from parent video."""
    type: Literal["video-excerpt"]
    from_seconds: int
    to_seconds: int


@dataclass
class ChatSegment:
    """Interactive chat within a section."""
    type: Literal["chat"]
    instructions: str
    show_user_previous_content: bool = True
    show_tutor_previous_content: bool = True


NarrativeSegment = TextSegment | ArticleExcerptSegment | VideoExcerptSegment | ChatSegment


@dataclass
class TextSection:
    """Standalone text section (no child segments)."""
    type: Literal["text"]
    content: str


@dataclass
class ArticleSection:
    """Article section with segments."""
    type: Literal["article"]
    source: str
    segments: list[NarrativeSegment]


@dataclass
class VideoSection:
    """Video section with segments."""
    type: Literal["video"]
    source: str
    segments: list[NarrativeSegment]


NarrativeSection = TextSection | ArticleSection | VideoSection


@dataclass
class NarrativeLesson:
    """A narrative-format lesson definition."""
    slug: str
    title: str
    sections: list[NarrativeSection]
```

**Step 2: Verify types compile**

Run: `python -c "from core.lessons.types import NarrativeLesson; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add dataclasses for narrative lesson types"
jj new
```

---

## Task 2: Add Narrative Lesson Loader

**Files:**
- Modify: `core/lessons/loader.py`

**Step 1: Add segment parsing helper**

Add after `_parse_stage` function:

```python
def _parse_narrative_segment(data: dict) -> NarrativeSegment:
    """Parse a narrative segment dict into a segment dataclass."""
    from .types import TextSegment, ArticleExcerptSegment, VideoExcerptSegment, ChatSegment

    segment_type = data["type"]

    if segment_type == "text":
        return TextSegment(type="text", content=data["content"])
    elif segment_type == "article-excerpt":
        return ArticleExcerptSegment(
            type="article-excerpt",
            from_text=data["from"],
            to_text=data["to"],
        )
    elif segment_type == "video-excerpt":
        return VideoExcerptSegment(
            type="video-excerpt",
            from_seconds=data["from"],
            to_seconds=data["to"],
        )
    elif segment_type == "chat":
        return ChatSegment(
            type="chat",
            instructions=data.get("instructions", ""),
            show_user_previous_content=data.get("showUserPreviousContent", True),
            show_tutor_previous_content=data.get("showTutorPreviousContent", True),
        )
    else:
        raise ValueError(f"Unknown narrative segment type: {segment_type}")
```

**Step 2: Add section parsing helper**

Add after the segment parser:

```python
def _parse_narrative_section(data: dict) -> NarrativeSection:
    """Parse a narrative section dict into a section dataclass."""
    from .types import TextSection, ArticleSection, VideoSection

    section_type = data["type"]

    if section_type == "text":
        return TextSection(type="text", content=data["content"])
    elif section_type == "article":
        segments = [_parse_narrative_segment(s) for s in data.get("segments", [])]
        return ArticleSection(
            type="article",
            source=data["source"],
            segments=segments,
        )
    elif section_type == "video":
        segments = [_parse_narrative_segment(s) for s in data.get("segments", [])]
        return VideoSection(
            type="video",
            source=data["source"],
            segments=segments,
        )
    else:
        raise ValueError(f"Unknown narrative section type: {section_type}")
```

**Step 3: Add narrative lesson loader**

Add after `load_lesson` function:

```python
def load_narrative_lesson(lesson_slug: str) -> NarrativeLesson:
    """
    Load a narrative lesson by slug from the lessons directory.

    Args:
        lesson_slug: The lesson slug (filename without .yaml extension)

    Returns:
        NarrativeLesson dataclass with parsed sections

    Raises:
        LessonNotFoundError: If lesson file doesn't exist
    """
    from .types import NarrativeLesson

    lesson_path = LESSONS_DIR / f"{lesson_slug}.yaml"

    if not lesson_path.exists():
        raise LessonNotFoundError(f"Lesson not found: {lesson_slug}")

    with open(lesson_path) as f:
        data = yaml.safe_load(f)

    sections = [_parse_narrative_section(s) for s in data["sections"]]

    return NarrativeLesson(
        slug=data["slug"],
        title=data["title"],
        sections=sections,
    )
```

**Step 4: Add imports at top of file**

Update the import from types:

```python
from .types import (
    Lesson, ArticleStage, VideoStage, ChatStage, Stage,
    NarrativeLesson, NarrativeSection, NarrativeSegment,
    TextSection, ArticleSection, VideoSection,
    TextSegment, ArticleExcerptSegment, VideoExcerptSegment, ChatSegment,
)
```

**Step 5: Verify loader works**

Run: `python -c "from core.lessons.loader import load_narrative_lesson; print(load_narrative_lesson('narrative-test'))"`
Expected: Prints the NarrativeLesson dataclass (may fail if YAML structure doesn't match yet)

**Step 6: Commit**

```bash
jj describe -m "feat(narrative): add loader for narrative lesson YAML"
jj new
```

---

## Task 3: Add Content Bundling Function

**Files:**
- Modify: `core/lessons/content.py`

**Step 1: Add function to bundle narrative lesson content**

Add at the end of the file:

```python
def bundle_narrative_lesson(lesson) -> dict:
    """
    Bundle a narrative lesson with all content extracted.

    Resolves all article excerpts and video transcripts inline.

    Args:
        lesson: NarrativeLesson dataclass

    Returns:
        Dict ready for JSON serialization
    """
    from .types import (
        TextSection, ArticleSection, VideoSection,
        TextSegment, ArticleExcerptSegment, VideoExcerptSegment, ChatSegment,
    )
    from .loader import load_narrative_lesson
    from core.transcripts import get_text_at_time

    def bundle_segment(segment, section) -> dict:
        """Bundle a single segment with content."""
        if isinstance(segment, TextSegment):
            return {"type": "text", "content": segment.content}

        elif isinstance(segment, ArticleExcerptSegment):
            # Extract content from parent article
            if isinstance(section, ArticleSection):
                result = load_article_with_metadata(
                    section.source,
                    segment.from_text,
                    segment.to_text,
                )
                return {"type": "article-excerpt", "content": result.content}
            return {"type": "article-excerpt", "content": ""}

        elif isinstance(segment, VideoExcerptSegment):
            # Extract transcript from parent video
            if isinstance(section, VideoSection):
                video_result = load_video_transcript_with_metadata(section.source)
                video_id = video_result.metadata.video_id
                try:
                    transcript = get_text_at_time(
                        video_id,
                        segment.from_seconds,
                        segment.to_seconds,
                    )
                except FileNotFoundError:
                    transcript = ""
                return {
                    "type": "video-excerpt",
                    "from": segment.from_seconds,
                    "to": segment.to_seconds,
                    "transcript": transcript,
                }
            return {"type": "video-excerpt", "from": 0, "to": 0, "transcript": ""}

        elif isinstance(segment, ChatSegment):
            return {
                "type": "chat",
                "instructions": segment.instructions,
                "showUserPreviousContent": segment.show_user_previous_content,
                "showTutorPreviousContent": segment.show_tutor_previous_content,
            }

        return {}

    def bundle_section(section) -> dict:
        """Bundle a single section with metadata and content."""
        if isinstance(section, TextSection):
            return {"type": "text", "content": section.content}

        elif isinstance(section, ArticleSection):
            # Load article metadata
            try:
                result = load_article_with_metadata(section.source)
                meta = {
                    "title": result.metadata.title,
                    "author": result.metadata.author,
                    "sourceUrl": result.metadata.source_url,
                }
            except FileNotFoundError:
                meta = {"title": None, "author": None, "sourceUrl": None}

            segments = [bundle_segment(s, section) for s in section.segments]
            return {"type": "article", "meta": meta, "segments": segments}

        elif isinstance(section, VideoSection):
            # Load video metadata
            try:
                result = load_video_transcript_with_metadata(section.source)
                video_id = result.metadata.video_id
                meta = {
                    "title": result.metadata.title,
                    "channel": None,  # Not in current frontmatter
                }
            except FileNotFoundError:
                video_id = None
                meta = {"title": None, "channel": None}

            segments = [bundle_segment(s, section) for s in section.segments]
            return {
                "type": "video",
                "videoId": video_id,
                "meta": meta,
                "segments": segments,
            }

        return {}

    return {
        "slug": lesson.slug,
        "title": lesson.title,
        "sections": [bundle_section(s) for s in lesson.sections],
    }
```

**Step 2: Verify it compiles**

Run: `python -c "from core.lessons.content import bundle_narrative_lesson; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
jj describe -m "feat(narrative): add content bundling for narrative lessons"
jj new
```

---

## Task 4: Update API Endpoint

**Files:**
- Modify: `web_api/routes/lessons.py`

**Step 1: Add imports**

Add to the imports from `core.lessons`:

```python
from core.lessons import (
    # ... existing imports ...
    load_narrative_lesson,
    bundle_narrative_lesson,
)
```

**Step 2: Update get_lesson endpoint**

Replace the `get_lesson` function with:

```python
@router.get("/lessons/{lesson_slug}")
async def get_lesson(lesson_slug: str):
    """Get a lesson definition (supports both staged and narrative formats)."""
    # First try loading as narrative lesson
    try:
        lesson = load_narrative_lesson(lesson_slug)
        return bundle_narrative_lesson(lesson)
    except (LessonNotFoundError, KeyError):
        pass  # Not a narrative lesson or missing 'sections' key

    # Fall back to staged lesson format
    try:
        lesson = load_lesson(lesson_slug)
        return {
            "slug": lesson.slug,
            "title": lesson.title,
            "stages": [
                {
                    "type": s.type,
                    **(
                        {
                            "source": s.source,
                            "from": s.from_text,
                            "to": s.to_text,
                            "optional": s.optional,
                            "introduction": s.introduction,
                        }
                        if s.type == "article"
                        else {}
                    ),
                    **(serialize_video_stage(s) if s.type == "video" else {}),
                    **(
                        {
                            "instructions": s.instructions,
                            "showUserPreviousContent": s.show_user_previous_content,
                            "showTutorPreviousContent": s.show_tutor_previous_content,
                        }
                        if s.type == "chat"
                        else {}
                    ),
                }
                for s in lesson.stages
            ],
        }
    except LessonNotFoundError:
        raise HTTPException(status_code=404, detail="Lesson not found")
```

**Step 3: Test manually**

Run the dev server and test:

```bash
curl http://localhost:8000/api/lessons/narrative-test | jq .
```

Expected: JSON with sections, segments, and bundled content

**Step 4: Commit**

```bash
jj describe -m "feat(narrative): update /api/lessons endpoint to support narrative format"
jj new
```

---

## Task 5: Add Position-Aware Message Endpoint

**Files:**
- Modify: `web_api/routes/lessons.py`

**Step 1: Update SendMessageRequest model**

Find `SendMessageRequest` and update it:

```python
class SendMessageRequest(BaseModel):
    content: str
    section_index: int | None = None  # For narrative lessons
    segment_index: int | None = None  # For narrative lessons
```

**Step 2: Add helper to get chat context from narrative position**

Add this helper function before `send_message_endpoint`:

```python
def get_narrative_chat_context(
    lesson: NarrativeLesson,
    section_index: int,
    segment_index: int,
) -> tuple[str, str | None]:
    """
    Get chat instructions and previous content for a narrative lesson position.

    Args:
        lesson: NarrativeLesson dataclass
        section_index: Section index (0-based)
        segment_index: Segment index within section (0-based)

    Returns:
        Tuple of (instructions, previous_content or None)
    """
    from core.lessons.types import (
        ArticleSection, VideoSection, ChatSegment,
        ArticleExcerptSegment, VideoExcerptSegment, TextSegment,
    )
    from core.lessons.content import load_article_with_metadata, load_video_transcript_with_metadata
    from core.transcripts import get_text_at_time

    section = lesson.sections[section_index]

    # Only article/video sections have segments
    if not hasattr(section, 'segments'):
        return "", None

    segment = section.segments[segment_index]

    if not isinstance(segment, ChatSegment):
        return "", None

    instructions = segment.instructions
    previous_content = None

    # Get previous content if enabled
    if segment.show_tutor_previous_content and segment_index > 0:
        # Look back for the most recent content segment
        for i in range(segment_index - 1, -1, -1):
            prev_seg = section.segments[i]

            if isinstance(prev_seg, ArticleExcerptSegment) and isinstance(section, ArticleSection):
                result = load_article_with_metadata(
                    section.source,
                    prev_seg.from_text,
                    prev_seg.to_text,
                )
                previous_content = result.content
                break

            elif isinstance(prev_seg, VideoExcerptSegment) and isinstance(section, VideoSection):
                video_result = load_video_transcript_with_metadata(section.source)
                video_id = video_result.metadata.video_id
                try:
                    previous_content = get_text_at_time(
                        video_id,
                        prev_seg.from_seconds,
                        prev_seg.to_seconds,
                    )
                except FileNotFoundError:
                    pass
                break

    return instructions, previous_content
```

**Step 3: Update send_message_endpoint**

Find the `send_message_endpoint` function and update the content/context loading section to handle narrative lessons:

After this existing code block:
```python
    # Load lesson and current stage
    lesson = load_lesson(session["lesson_slug"])
```

Add a check for narrative lessons:

```python
    # Check if this is a narrative lesson with position info
    is_narrative = request_body.section_index is not None and request_body.segment_index is not None

    if is_narrative:
        try:
            narrative_lesson = load_narrative_lesson(session["lesson_slug"])
            instructions, previous_content = get_narrative_chat_context(
                narrative_lesson,
                request_body.section_index,
                request_body.segment_index,
            )
            # For narrative lessons, we use a simplified chat stage
            from core.lessons.types import ChatStage
            current_stage = ChatStage(
                type="chat",
                instructions=instructions,
                show_user_previous_content=True,
                show_tutor_previous_content=True,
            )
            current_content = None  # Not used for narrative chat
        except (LessonNotFoundError, IndexError):
            raise HTTPException(status_code=400, detail="Invalid lesson or position")
    else:
        # Existing staged lesson logic...
```

Note: This is a larger change - the full diff would refactor the function to handle both cases. For now, leave a TODO comment and we'll refine in the next task.

**Step 4: Commit**

```bash
jj describe -m "feat(narrative): add position-aware chat context for narrative lessons"
jj new
```

---

## Task 6: Update Frontend to Use Real API

**Files:**
- Modify: `web_frontend_next/src/app/narrative/[lessonId]/page.tsx`

**Step 1: Replace hardcoded data with API call**

Replace the `fetchNarrativeLesson` function:

```typescript
async function fetchNarrativeLesson(
  slug: string,
): Promise<NarrativeLessonType | null> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const response = await fetch(`${apiBase}/api/lessons/${slug}`);

  if (!response.ok) {
    return null;
  }

  const data = await response.json();

  // Check if this is a narrative lesson (has sections, not stages)
  if (!data.sections) {
    return null;
  }

  return data as NarrativeLessonType;
}
```

**Step 2: Remove the hardcoded TEST_LESSON constant**

Delete the entire `const TEST_LESSON: NarrativeLessonType = {...}` block.

**Step 3: Test in browser**

Navigate to `http://localhost:3000/narrative/narrative-test`
Expected: Lesson loads with real content from API

**Step 4: Commit**

```bash
jj describe -m "feat(narrative): connect frontend to real lesson API"
jj new
```

---

## Task 7: Update Test YAML to Match New Format

**Files:**
- Modify: `educational_content/lessons/narrative-test.yaml`

**Step 1: Update YAML with chat instructions**

The current YAML has `type: chat` segments but no instructions. Update them:

```yaml
# educational_content/lessons/narrative-test.yaml
slug: narrative-test
title: "Test Narrative Lesson"

sections:
  - type: article
    source: articles/tim-urban-artificial-intelligence-revolution-1.md
    segments:
      - type: text
        content: |
          Welcome to this lesson on the AI Revolution.

          We'll be reading Tim Urban's famous essay from Wait But Why.
          Pay attention to the concept of "Die Progress Units" - it's a
          memorable way to think about accelerating change.

      - type: article-excerpt
        from: "What does it feel like to stand here?"
        to: "## The Far Future—Coming Soon"

      - type: text
        content: |
          **Reflection question:**

          Urban describes bringing someone from 1750 to today. What do you
          think would shock them most - and what might they adapt to quickly?

      - type: chat
        instructions: |
          The user just read about the accelerating pace of change and "Die Progress Units."

          Ask what they found most surprising about the time-travel thought experiment.
          Help them articulate the difference between linear and exponential thinking.
        showUserPreviousContent: true
        showTutorPreviousContent: true

      - type: article-excerpt
        from: "## The Far Future—Coming Soon"
        to: "## What Is AI?"

      - type: text
        content: |
          Urban introduces the idea of **exponential thinking** vs **linear thinking**.

          This is one of the most common mistakes people make when predicting
          the future of AI. Let's make sure you understand it.

      - type: chat
        instructions: |
          Check the user's understanding of exponential vs linear thinking.

          Ask them to explain it in their own words. If they struggle,
          use concrete examples like rice on a chessboard or compound interest.
        showUserPreviousContent: true
        showTutorPreviousContent: true

  - type: video
    source: video_transcripts/fa8k8IQ1_X0_A.I._‐_Humanity's_Final_Invention.md
    segments:
      - type: text
        content: |
          Now let's watch a video that covers similar ground with some
          additional visual explanations.

      - type: video-excerpt
        from: 0
        to: 180

      - type: text
        content: |
          **Quick check:** What's the key difference between ANI and AGI?

      - type: chat
        instructions: |
          The user just watched the first 3 minutes about AI history and capabilities.

          Check if they understand the ANI vs AGI distinction.
          Ask them to give examples of each type.
        showUserPreviousContent: true
        showTutorPreviousContent: true

      - type: text
        content: |
          ## Summary

          Key takeaways from this lesson:
          - Progress is exponential, not linear
          - We're currently in the ANI era
          - The AGI → ASI transition could be rapid
```

**Step 2: Verify the YAML loads**

```bash
python -c "from core.lessons.loader import load_narrative_lesson; print(load_narrative_lesson('narrative-test'))"
```

**Step 3: Commit**

```bash
jj describe -m "content: add chat instructions to narrative-test lesson"
jj new
```

---

## Task 8: Export New Functions from core/lessons/__init__.py

**Files:**
- Modify: `core/lessons/__init__.py`

**Step 1: Add exports**

Add to the exports:

```python
from .loader import load_narrative_lesson
from .content import bundle_narrative_lesson
from .types import (
    NarrativeLesson,
    NarrativeSection,
    NarrativeSegment,
    TextSection,
    ArticleSection,
    VideoSection,
    TextSegment,
    ArticleExcerptSegment,
    VideoExcerptSegment,
)
```

**Step 2: Commit**

```bash
jj describe -m "chore: export narrative lesson types and functions"
jj new
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add dataclasses for narrative types | `core/lessons/types.py` |
| 2 | Add YAML loader for narrative lessons | `core/lessons/loader.py` |
| 3 | Add content bundling function | `core/lessons/content.py` |
| 4 | Update `/api/lessons/{slug}` endpoint | `web_api/routes/lessons.py` |
| 5 | Add position-aware chat context | `web_api/routes/lessons.py` |
| 6 | Connect frontend to real API | `web_frontend_next/.../page.tsx` |
| 7 | Update test YAML with instructions | `educational_content/lessons/narrative-test.yaml` |
| 8 | Export new functions | `core/lessons/__init__.py` |

**Testing approach:**
- Manual testing with dev server
- `curl` to verify API responses
- Browser testing at `/narrative/narrative-test`
