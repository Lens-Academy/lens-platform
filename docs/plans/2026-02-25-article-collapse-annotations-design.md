# Design: Article Collapse & Annotations

## Context

Course developers curate external articles for the Lens Academy platform. They need tools to customize the reading experience: hide irrelevant sections, add explanatory notes, and guide learners through the material. Currently, the only content customization is excerpt-level `collapsed_before`/`collapsed_after` (hiding content outside excerpt boundaries). There's no way to collapse or annotate content *within* an article.

## Syntax: Generic Directives (remark-directive)

We use the **CommonMark Generic Directives** syntax, implemented by `remark-directive` (well-maintained remark plugin). Three levels:

| Level | Syntax | Use case |
|---|---|---|
| Inline | `:name[content]{attrs}` | Collapse/annotate words within a paragraph |
| Leaf block | `::name[content]{attrs}` | Standalone one-liner (no wrapping) |
| Container block | `:::name` ... `:::` | Wrap multiple paragraphs |

Directives are written directly in article markdown files by course developers. They are visible in Obsidian as raw text (not hidden like HTML tags). They don't collide with CriticMarkup (which the project also uses).

`from::`/`to::` lens anchors match against raw markdown including directive syntax.

## Phase 1: Collapse

Hide content within articles. Shows `[...]` indicator, expandable by the reader.

### Syntax

**Block collapse** — hide one or more paragraphs:
```md
:::collapse
This paragraph is hidden by default.

So is this one.
:::
```

**Inline collapse** — hide a phrase within a paragraph:
```md
The concept of :collapse[power-seeking behavior in AI systems] is important.
```

**Multi-sentence inline** — collapse several sentences within a paragraph:
```md
This introduces the topic. :collapse[These sentences are a tangent about the author's podcast. You can find it on Spotify.] Now back to the main argument.
```

**Collapsing from mid-paragraph across paragraphs** — split the paragraph:
```md
This is the intro sentence.

:::collapse
The rest of this paragraph was a tangent about podcasts.

This second paragraph continued the tangent.
:::

Back to the main argument.
```

### Rendering

**Block collapse (collapsed state):**
- `▸ [...]` button, light gray text
- Reuse the existing `CollapsedSection` animation pattern (grid-template-rows transition)

**Block collapse (expanded state):**
- Content shown with smooth animation
- Slightly muted text (`text-gray-600`) with left indent
- "— End of collapsed text —" marker (matching existing pattern)

**Inline collapse (collapsed state):**
- `[...]` inline in text flow, clickable, gray styling

**Inline collapse (expanded state):**
- Text appears inline, slightly dimmed background to indicate it was collapsed

---

## Phase 2: Annotations (future)

Course-maker notes added to articles. Two modes:
- **NC (normally closed):** collapsed by default, expand on click
- **NO (normally open):** visible by default, can collapse

### Syntax

**Block annotation (one-liner):**
```md
::note[This is a course-maker note.]
::note[Read this section carefully.]{open}
```

**Block annotation (wrapping content):**
```md
:::note
This is a longer course-maker note that spans
multiple paragraphs.
:::
```

**Inline annotation:**
```md
The concept of :note[this is key for the course] power-seeking is important.
```

**Annotation inside collapse (explains why content was hidden):**
```md
:::collapse
This section discusses the author's podcast.

::note[We collapsed this because it's not relevant to the learning outcome.]
:::
```

### Rendering

- White background callout box (matching existing AuthoredText style)
- Visually distinct from article content (which has amber background)
- NC: collapsed behind a toggle; NO: expanded by default
- Inline: small indicator for NC, styled inline text for NO
