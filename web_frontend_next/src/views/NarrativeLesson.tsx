// web_frontend_next/src/views/NarrativeLesson.tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type {
  ChatMessage,
  PendingMessage,
  ArticleData,
} from "@/types/unified-lesson";
import type {
  NarrativeLesson as NarrativeLessonType,
  NarrativeSection,
  NarrativeSegment,
} from "@/types/narrative-lesson";
import { sendMessage, createSession, getSession } from "@/api/lessons";
import { useAnonymousSession } from "@/hooks/useAnonymousSession";
import AuthoredText from "@/components/narrative-lesson/AuthoredText";
import ArticleEmbed from "@/components/narrative-lesson/ArticleEmbed";
import VideoEmbed from "@/components/narrative-lesson/VideoEmbed";
import NarrativeChatSection from "@/components/narrative-lesson/NarrativeChatSection";
import ProgressSidebar from "@/components/narrative-lesson/ProgressSidebar";

type NarrativeLessonProps = {
  lesson: NarrativeLessonType;
};

/**
 * Main view for NarrativeLesson format.
 *
 * Renders a continuous vertical scroll with:
 * - Authored text (white bg)
 * - Article excerpts (gray card)
 * - Video excerpts (gray card, 80% width)
 * - Chat sections (75vh, all sharing same state)
 * - Progress sidebar on left
 */
export default function NarrativeLesson({ lesson }: NarrativeLessonProps) {
  // Chat state (shared across all chat sections)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(
    null,
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Session state
  const [sessionId, setSessionId] = useState<number | null>(null);
  const { getStoredSessionId, storeSessionId, clearSessionId } =
    useAnonymousSession(lesson.slug);

  // Progress tracking
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [scrollProgress, setScrollProgress] = useState(0);
  const sectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Initialize session
  useEffect(() => {
    async function init() {
      const storedId = getStoredSessionId();
      if (storedId) {
        try {
          const state = await getSession(storedId);
          setSessionId(storedId);
          setMessages(state.messages);
          return;
        } catch {
          clearSessionId();
        }
      }

      // Create new session
      const sid = await createSession(lesson.slug);
      storeSessionId(sid);
      setSessionId(sid);
    }

    init();
  }, [lesson.slug, getStoredSessionId, storeSessionId, clearSessionId]);

  // Send message handler (shared across all chat sections)
  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return;

      if (content) {
        setPendingMessage({ content, status: "sending" });
      }
      setIsLoading(true);
      setStreamingContent("");

      try {
        let assistantContent = "";

        for await (const chunk of sendMessage(sessionId, content)) {
          if (chunk.type === "text" && chunk.content) {
            assistantContent += chunk.content;
            setStreamingContent(assistantContent);
          }
        }

        // Update messages
        setMessages((prev) => [
          ...prev,
          ...(content ? [{ role: "user" as const, content }] : []),
          { role: "assistant" as const, content: assistantContent },
        ]);
        setPendingMessage(null);
        setStreamingContent("");
      } catch {
        if (content) {
          setPendingMessage({ content, status: "failed" });
        }
        setStreamingContent("");
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId],
  );

  const handleRetryMessage = useCallback(() => {
    if (!pendingMessage) return;
    const content = pendingMessage.content;
    setPendingMessage(null);
    handleSendMessage(content);
  }, [pendingMessage, handleSendMessage]);

  // Scroll tracking with Intersection Observer
  // Use setTimeout to ensure refs are populated after render
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(
              entry.target.getAttribute("data-section-index"),
            );
            if (!isNaN(index)) {
              setCurrentSectionIndex(index);
            }
          }
        });
      },
      { threshold: 0.3 },
    );

    // Delay observation to ensure refs are populated
    const timeout = setTimeout(() => {
      sectionRefs.current.forEach((el) => {
        observer.observe(el);
      });
    }, 0);

    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [lesson.sections]);

  // Track scroll progress within current section
  useEffect(() => {
    const handleScroll = () => {
      const currentEl = sectionRefs.current.get(currentSectionIndex);
      if (!currentEl) return;

      const rect = currentEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Calculate how much of the section has scrolled past the top
      const sectionTop = rect.top;
      const sectionHeight = rect.height;

      if (sectionTop >= viewportHeight) {
        setScrollProgress(0);
      } else if (sectionTop + sectionHeight <= 0) {
        setScrollProgress(1);
      } else {
        // Section is in view - calculate progress
        const scrolledAmount = Math.max(0, -sectionTop);
        const progress = Math.min(
          1,
          scrolledAmount / (sectionHeight - viewportHeight / 2),
        );
        setScrollProgress(progress);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [currentSectionIndex]);

  // Scroll to section
  const handleSectionClick = useCallback((index: number) => {
    const el = sectionRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  // Render a segment (sectionIndex included for unique keys)
  const renderSegment = (
    segment: NarrativeSegment,
    section: NarrativeSection,
    sectionIndex: number,
    segmentIndex: number,
  ) => {
    const keyPrefix = `${sectionIndex}-${segmentIndex}`;

    switch (segment.type) {
      case "text":
        return (
          <AuthoredText key={`text-${keyPrefix}`} content={segment.content} />
        );

      case "article-excerpt": {
        // Content is now bundled directly in the segment
        const articleMeta = section.type === "article" ? section.meta : null;
        const excerptData: ArticleData = {
          content: segment.content,
          title: articleMeta?.title ?? null,
          author: articleMeta?.author ?? null,
          sourceUrl: articleMeta?.sourceUrl ?? null,
          isExcerpt: true,
        };
        return (
          <ArticleEmbed
            key={`article-${keyPrefix}`}
            article={excerptData}
            showHeader={segmentIndex === 0}
          />
        );
      }

      case "video-excerpt":
        if (section.type !== "video") return null;
        return (
          <VideoEmbed
            key={`video-${keyPrefix}`}
            videoId={section.videoId}
            start={segment.from}
            end={segment.to}
          />
        );

      case "chat":
        return (
          <NarrativeChatSection
            key={`chat-${keyPrefix}`}
            messages={messages}
            pendingMessage={pendingMessage}
            streamingContent={streamingContent}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onRetryMessage={handleRetryMessage}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-semibold text-gray-900">{lesson.title}</h1>
        <Link
          href="/"
          className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Exit
        </Link>
      </header>

      {/* Progress sidebar */}
      <ProgressSidebar
        sections={lesson.sections}
        currentSectionIndex={currentSectionIndex}
        scrollProgress={scrollProgress}
        onSectionClick={handleSectionClick}
      />

      {/* Main content - pl-20 provides left padding for the sidebar */}
      <main className="pl-20">
        {lesson.sections.map((section, sectionIndex) => (
          <div
            key={sectionIndex}
            ref={(el) => {
              if (el) sectionRefs.current.set(sectionIndex, el);
            }}
            data-section-index={sectionIndex}
            className="py-8"
          >
            {section.type === "text" ? (
              <AuthoredText content={section.content} />
            ) : (
              section.segments.map((segment, segmentIndex) =>
                renderSegment(segment, section, sectionIndex, segmentIndex),
              )
            )}
          </div>
        ))}
      </main>
    </div>
  );
}
