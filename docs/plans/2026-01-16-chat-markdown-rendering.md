# Chat Markdown Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix bold/italic text showing asterisks instead of formatted text in chat messages

**Architecture:** Add ReactMarkdown to assistant message rendering in ChatPanel.tsx, reusing the same libraries already used by ArticlePanel.tsx

**Tech Stack:** react-markdown, remark-gfm (both already in bundle)

---

## Task 1: Add Markdown Rendering to ChatPanel

**Files:**
- Modify: `web_frontend/src/components/unified-lesson/ChatPanel.tsx`

**Step 1: Add imports at top of file**

After line 1, add the markdown imports:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
```

**Step 2: Create ChatMarkdown component**

Add this component inside ChatPanel.tsx, before the main `ChatPanel` function (around line 35):

```tsx
// Minimal markdown for chat - just inline formatting, no block elements
function ChatMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Inline formatting
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        // Render paragraphs as spans to avoid block-level spacing
        p: ({ children }) => <span>{children}</span>,
        // Links
        a: ({ href, children }) => (
          <a href={href} className="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        // Disable block elements - render as plain text
        h1: ({ children }) => <span>{children}</span>,
        h2: ({ children }) => <span>{children}</span>,
        h3: ({ children }) => <span>{children}</span>,
        blockquote: ({ children }) => <span>{children}</span>,
        ul: ({ children }) => <span>{children}</span>,
        ol: ({ children }) => <span>{children}</span>,
        li: ({ children }) => <span>{children} </span>,
        pre: ({ children }) => <span>{children}</span>,
        code: ({ children }) => (
          <code className="bg-gray-100 px-1 rounded text-sm">{children}</code>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
```

**Step 3: Update assistant message rendering**

Find line 460 (inside the messages.map):
```tsx
<div className="whitespace-pre-wrap">{msg.content}</div>
```

Replace with:
```tsx
<div className="whitespace-pre-wrap">
  {msg.role === "assistant" ? (
    <ChatMarkdown>{msg.content}</ChatMarkdown>
  ) : (
    msg.content
  )}
</div>
```

**Step 4: Update streaming content rendering**

Find line 499 (streaming message):
```tsx
<div className="whitespace-pre-wrap">{streamingContent}</div>
```

Replace with:
```tsx
<div className="whitespace-pre-wrap">
  <ChatMarkdown>{streamingContent}</ChatMarkdown>
</div>
```

**Step 5: Verify the changes work**

Run: `cd web_frontend && npm run build`
Expected: Build succeeds with no TypeScript errors

**Step 6: Manual test**

1. Start dev server: `python main.py --dev`
2. Go to a lesson with AI chat
3. Send a message that triggers an AI response with **bold** or *italic* text
4. Verify: Bold text appears bold, italic text appears italic (no asterisks visible)

**Step 7: Commit**

```bash
jj describe -m "fix: render markdown in chat messages

AI tutor responses now render **bold** and *italic* text properly
instead of showing raw asterisks."
```

---

## Summary

Single task, ~5 minutes of work:
1. Import react-markdown and remark-gfm
2. Add ChatMarkdown component with minimal inline-only rendering
3. Apply to assistant messages (line 460) and streaming content (line 499)
4. Build and test
