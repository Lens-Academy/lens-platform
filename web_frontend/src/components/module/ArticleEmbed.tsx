// web_frontend/src/components/module/ArticleEmbed.tsx

import { useState } from "react";
import {
  useFloating,
  useHover,
  useFocus,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  offset,
  flip,
  shift,
  FloatingPortal,
  safePolygon,
} from "@floating-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import rehypeRaw from "rehype-raw";
import { visit } from "unist-util-visit";
import type { ArticleData } from "@/types/module";
import { generateHeadingId } from "@/utils/extractHeadings";
import { useArticleSectionContext } from "./ArticleSectionContext";

/**
 * Remark plugin that converts directives into HTML elements.
 * - :::collapse ... ::: (container) → <collapse-block>
 * - :collapse[text] (inline) → <collapse-inline>
 * - :::note ... ::: (container) → <note-block> (always visible)
 * - ::note[text] (leaf) → <note-block> (always visible)
 * - :note[text] (inline) → <note-inline> (always visible)
 * - :footnote[text] / ::footnote[text] → <footnote-inline> (hover popup)
 */
function remarkLensDirectives() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    visit(tree, (node) => {
      if (node.type === "containerDirective" && node.name === "collapse") {
        const data = node.data || (node.data = {});
        data.hName = "collapse-block";
      }
      if (node.type === "textDirective" && node.name === "collapse") {
        const data = node.data || (node.data = {});
        data.hName = "collapse-inline";
      }
      if (
        (node.type === "containerDirective" ||
          node.type === "leafDirective") &&
        node.name === "note"
      ) {
        const data = node.data || (node.data = {});
        data.hName = "note-block";
      }
      if (node.type === "textDirective" && node.name === "note") {
        const data = node.data || (node.data = {});
        data.hName = "note-inline";
      }
      if (
        (node.type === "textDirective" || node.type === "leafDirective") &&
        node.name === "footnote"
      ) {
        const data = node.data || (node.data = {});
        data.hName = "footnote-inline";
      }
    });
  };
}

function CollapsibleBlock({
  children,
  className,
  expandedHint,
  endMarker,
}: {
  children: React.ReactNode;
  className?: string;
  expandedHint?: string;
  endMarker?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={className}>
      <div className="flex items-center gap-1 py-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="cursor-pointer text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1"
        >
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span>[...]</span>
        </button>
        {isOpen && expandedHint && (
          <span className="text-sm text-gray-400 ml-1">{expandedHint}</span>
        )}
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {children}
          {endMarker && (
            <div className="text-sm text-gray-400 mt-2 pl-5">
              {endMarker}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockCollapse({ children }: { children?: React.ReactNode }) {
  return (
    <CollapsibleBlock
      className="my-2"
      expandedHint="This part of the article was omitted for brevity"
      endMarker="— End of omitted text —"
    >
      <div className="text-gray-600 pt-1 pl-5">{children}</div>
    </CollapsibleBlock>
  );
}

function InlineCollapse({ children }: { children?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="cursor-pointer text-sm text-gray-400 hover:text-gray-600 inline"
      >
        [...]
      </button>
    );
  }

  return (
    <span className="bg-gray-100/50 rounded px-0.5 animate-[fadeIn_0.3s_ease-out]">
      <button
        onClick={() => setIsOpen(false)}
        className="cursor-pointer text-xs text-gray-400 hover:text-gray-600 mr-1 inline"
      >
        [collapse]
      </button>
      {children}
    </span>
  );
}

/**
 * Splits article content at top-level block note directives (:::note and ::note[]).
 * Notes nested inside other containers (e.g. :::collapse) are left in place.
 * Returns alternating article/note segments for rendering with different backgrounds.
 */
type ContentSegment = { type: "article" | "note"; content: string };
function splitAtBlockNotes(content: string): ContentSegment[] {
  const lines = content.split("\n");
  const segments: ContentSegment[] = [];
  let articleLines: string[] = [];
  let depth = 0; // container nesting depth (for non-note containers)
  let collectingNote = false;
  let noteLines: string[] = [];
  let noteInnerDepth = 0; // for nested containers within a note

  for (const line of lines) {
    const isContainerOpen = /^:::[a-z]/.test(line);
    const isContainerClose = line.trim() === ":::";
    const isNoteOpen = /^:::note(\{.*\})?$/.test(line);
    const isLeafNote = /^::note\[/.test(line);

    if (collectingNote) {
      if (isContainerOpen) {
        noteInnerDepth++;
        noteLines.push(line);
      } else if (isContainerClose && noteInnerDepth > 0) {
        noteInnerDepth--;
        noteLines.push(line);
      } else if (isContainerClose && noteInnerDepth === 0) {
        segments.push({ type: "note", content: noteLines.join("\n") });
        noteLines = [];
        collectingNote = false;
      } else {
        noteLines.push(line);
      }
    } else if (depth === 0 && isNoteOpen) {
      if (articleLines.length > 0) {
        segments.push({
          type: "article",
          content: articleLines.join("\n"),
        });
        articleLines = [];
      }
      collectingNote = true;
      noteInnerDepth = 0;
      noteLines = [];
    } else if (depth === 0 && isLeafNote) {
      if (articleLines.length > 0) {
        segments.push({
          type: "article",
          content: articleLines.join("\n"),
        });
        articleLines = [];
      }
      const match = line.match(/^::note\[(.*?)\](?:\{.*\})?$/);
      if (match) {
        segments.push({ type: "note", content: match[1] });
      }
    } else {
      if (isContainerOpen && !isNoteOpen) depth++;
      if (isContainerClose && depth > 0) depth--;
      articleLines.push(line);
    }
  }

  // Handle unclosed note gracefully
  if (collectingNote && noteLines.length > 0) {
    articleLines.push(":::note", ...noteLines);
  }
  if (articleLines.length > 0) {
    segments.push({ type: "article", content: articleLines.join("\n") });
  }

  return segments;
}

/** Shared note box used by both top-level block notes and notes inside containers. */
function NoteBox({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-gray-100 bg-white/85 shadow-[inset_0_0_6px_0_rgba(0,0,0,0.06)] px-4 py-3 text-sm text-gray-700 leading-relaxed relative ${className ?? ""}`}>
      <div className="absolute top-2 right-3 flex items-center gap-1.5 text-sm text-gray-600">
        <img src="/assets/Logo only.png" alt="" className="w-4 h-4 opacity-70 !my-0" />
        <span>Lens</span>
      </div>
      {children}
    </div>
  );
}

/** Block note rendered inside a container (e.g. inside :::collapse). */
function BlockNote({ children }: { children?: React.ReactNode }) {
  return <NoteBox className="my-3">{children}</NoteBox>;
}

function InlineNote({ children }: { children?: React.ReactNode }) {
  return (
    <span className="bg-white/85 rounded border border-gray-100 shadow-[inset_0_0_4px_0_rgba(0,0,0,0.06)] px-1.5 py-0.5">
      <img src="/assets/Logo only.png" alt="Lens" className="inline h-[1em] w-auto opacity-70 align-baseline mr-1 !my-0 translate-y-[0.08em]" />{children}
    </span>
  );
}

function InlineFootnote({ children }: { children?: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    delay: { open: 0, close: 300 },
    handleClose: safePolygon(),
  });
  const click = useClick(context);
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    click,
    focus,
    dismiss,
    role,
  ]);

  return (
    <>
      <span
        ref={refs.setReference}
        {...getReferenceProps()}
        tabIndex={0}
        className="inline-flex items-center justify-center w-[1.38em] h-[1.38em] mx-0.5 rounded-full
          bg-gray-100 shadow-sm hover:bg-gray-200 cursor-default align-middle -translate-y-[0.1em]"
      >
        <img
          src="/assets/Logo only.png"
          alt="footnote"
          role="img"
          className="w-[1.03em] h-[1.03em] opacity-70 !my-0 translate-x-[0.03em] -translate-y-[0.03em]"
        />
      </span>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-64 max-w-[80vw] px-3 py-2 text-sm text-gray-700 bg-white
              rounded-lg shadow-lg border border-gray-200 leading-relaxed"
          >
            <span className="absolute top-1.5 right-2 flex items-center">
              <img src="/assets/Logo only.png" alt="" className="w-[1.1em] h-[1.1em] opacity-70 !my-0" />
            </span>
            {children}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

type ArticleEmbedProps = {
  article: ArticleData;
  /** Whether this is the first excerpt in the section (shows full attribution) */
  isFirstExcerpt?: boolean;
};

/**
 * Renders article content with warm background.
 * First excerpt shows full attribution; subsequent show muted marker.
 */
export default function ArticleEmbed({
  article,
  isFirstExcerpt,
}: ArticleEmbedProps) {
  const isFirst = isFirstExcerpt ?? true;
  const {
    content,
    title,
    author,
    sourceUrl,
    collapsed_before,
    collapsed_after,
  } = article;
  const sectionContext = useArticleSectionContext();

  // Get heading ID - uses shared counter from context if available,
  // falls back to local generation for standalone use
  const getHeadingId = (text: string): string => {
    if (sectionContext?.getHeadingId) {
      return sectionContext.getHeadingId(text);
    }
    // Fallback for when rendered outside ArticleSectionWrapper
    return generateHeadingId(text);
  };

  // Shared markdown components for both main content and collapsed sections
  const markdownComponents = {
    a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-gray-700 underline decoration-gray-400 hover:decoration-gray-600"
      >
        {children}
      </a>
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-2xl font-bold mt-8 mb-4">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => {
      const text = String(children);
      const id = getHeadingId(text);
      return (
        <h2
          id={id}
          ref={(el) => {
            if (el) sectionContext?.onHeadingRender(id, el);
          }}
          className="text-xl font-bold mt-6 mb-3 scroll-mt-24"
        >
          {children}
        </h2>
      );
    },
    h3: ({ children }: { children?: React.ReactNode }) => {
      const text = String(children);
      const id = getHeadingId(text);
      return (
        <h3
          id={id}
          ref={(el) => {
            if (el) sectionContext?.onHeadingRender(id, el);
          }}
          className="text-lg font-bold mt-5 mb-2 scroll-mt-24"
        >
          {children}
        </h3>
      );
    },
    h4: ({ children }: { children?: React.ReactNode }) => (
      <h4 className="text-base font-bold mt-4 mb-2">{children}</h4>
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-4 leading-relaxed">{children}</p>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal list-inside mb-4 space-y-1">{children}</ol>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic">{children}</em>
    ),
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="not-prose border-l-3 border-gray-300 pl-4 my-4 text-gray-800 [&>p]:mb-0">
        {children}
      </blockquote>
    ),
    code: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">
            {children}
          </code>
        );
      }
      return <code className="text-sm font-mono">{children}</code>;
    },
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto my-4">
        {children}
      </pre>
    ),
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <img
        src={src}
        alt={alt || ""}
        className="w-full max-w-full my-4 rounded-lg"
      />
    ),
    hr: () => <hr className="my-8 border-gray-300" />,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-gray-300">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-gray-200">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody>{children}</tbody>
    ),
    tr: ({ children }: { children?: React.ReactNode }) => (
      <tr className="border-b border-gray-300">{children}</tr>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-4 py-2 text-left font-semibold border border-gray-300">
        {children}
      </th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-4 py-2 border border-gray-300">{children}</td>
    ),
    "collapse-block": BlockCollapse,
    "collapse-inline": InlineCollapse,
    "note-block": BlockNote,
    "note-inline": InlineNote,
    "footnote-inline": InlineFootnote,
  };

  // Collapsed section component with animation
  const CollapsedSection = ({
    content,
  }: {
    content: string;
  }) => {
    return (
      <CollapsibleBlock
        className="max-w-content mx-auto mb-4"
        expandedHint="This part of the article was omitted for brevity"
        endMarker="— End of omitted text —"
      >
        <article className="prose prose-gray max-w-content mx-auto text-gray-600 pt-1 pl-5">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkDirective, remarkLensDirectives]}
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </article>
      </CollapsibleBlock>
    );
  };

  // Split content at top-level block notes for alternating backgrounds
  const segments = splitAtBlockNotes(content);

  const remarkPlugins = [remarkGfm, remarkDirective, remarkLensDirectives];
  const rehypePlugins = [rehypeRaw];

  return (
    <div className="max-w-content-padded mx-auto rounded-lg overflow-hidden">
      {/* Header — always yellow */}
      <div className="bg-amber-50/50 px-4 pt-4 sm:pt-6 pb-2">
        {isFirst ? (
          <div className="mb-1 max-w-content mx-auto">
            {title && (
              <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            )}
            <div className="flex items-center gap-3 mt-1">
              {author && <p className="text-sm text-gray-500">by {author}</p>}
              {author && sourceUrl && <span className="text-gray-400">|</span>}
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1"
                >
                  Read original
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              )}
            </div>
            <hr className="mt-3 border-gray-300" />
          </div>
        ) : (
          <div className="mb-1 max-w-content mx-auto">
            <div className="flex justify-end">
              <span className="text-sm text-gray-400 flex items-center gap-1.5">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                from &ldquo;{title}&rdquo;
              </span>
            </div>
            <hr className="mt-2 border-gray-300" />
          </div>
        )}

        {collapsed_before && (
          <CollapsedSection content={collapsed_before} />
        )}
      </div>

      {/* Content segments — alternating yellow (article) / white (note) */}
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1;

        if (segment.type === "note") {
          return (
            <div key={i} className="bg-amber-50/50 px-4 py-2">
              <NoteBox className="max-w-[calc(var(--container-content)+2rem)] mx-auto">
                <article className="prose prose-gray max-w-content [&>*:last-child]:mb-0">
                  <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={markdownComponents}
                  >
                    {segment.content}
                  </ReactMarkdown>
                </article>
              </NoteBox>
            </div>
          );
        }

        return (
          <div
            key={i}
            className={`bg-amber-50/50 px-4 py-1 ${isLast ? "pb-4 sm:pb-6" : ""}`}
          >
            <article className="prose prose-gray max-w-content mx-auto overflow-x-hidden [&>*:last-child]:mb-0">
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
              >
                {segment.content}
              </ReactMarkdown>
            </article>
            {isLast && collapsed_after && (
              <CollapsedSection content={collapsed_after} />
            )}
          </div>
        );
      })}

      {/* If last segment is a note, add yellow footer for collapsed_after + bottom padding */}
      {segments[segments.length - 1]?.type === "note" && (
        <div className="bg-amber-50/50 px-4 pb-4 sm:pb-6">
          {collapsed_after && (
            <CollapsedSection content={collapsed_after} />
          )}
        </div>
      )}
    </div>
  );
}
