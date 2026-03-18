// web_frontend/src/components/module/SectionDivider.tsx
import { StickyNote, BotMessageSquare } from "lucide-react";
import { formatDurationMinutes } from "../../utils/duration";
import { OptionalBadge } from "../OptionalBadge";

type DurationBreakdown = {
  total: number;
  contentTime: number;
  aiTime: number;
  hasVideo: boolean;
};

type SectionDividerProps = {
  type:
    | "video"
    | "article"
    | "chat"
    | "lens-video"
    | "lens-article"
    | "page"
    | "test";
  optional?: boolean;
  title?: string;
  duration?: DurationBreakdown | null;
};

function Icon({ type }: { type: "video" | "article" | "page" | "test" }) {
  if (type === "test") {
    return (
      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  if (type === "page") {
    return <StickyNote className="w-8 h-8" strokeWidth={2} />;
  }

  if (type === "article") {
    return (
      <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // Video
  return (
    <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default function SectionDivider({
  type,
  optional,
  title,
  duration,
}: SectionDividerProps) {
  // Map section types to icon types
  // lens-video and video use the video icon
  // lens-article, article, chat, and page use the article icon
  const iconType =
    type === "video" || type === "lens-video"
      ? "video"
      : type === "test"
        ? "test"
        : type === "page"
          ? "page"
          : "article";

  return (
    <div className="flex flex-col items-center gap-2 px-4 sm:px-6 py-6">
      <div className="flex items-center gap-4 w-full">
        <div
          className="flex-1 border-t"
          style={{ borderColor: "var(--brand-border)" }}
        />
        <div className="flex items-center gap-2 text-gray-600">
          <Icon type={iconType} />
          {title && (
            <span className="text-xl font-medium font-display">{title}</span>
          )}
        </div>
        <div
          className="flex-1 border-t"
          style={{ borderColor: "var(--brand-border)" }}
        />
      </div>
      {duration != null && duration.total > 0 ? (
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          {optional && <OptionalBadge />}
          {duration.contentTime > 0 && duration.aiTime > 0 ? (
            <>
              {duration.hasVideo ? (
                <svg
                  className="w-3.5 h-3.5 inline translate-y-px"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  className="w-3.5 h-3.5 inline translate-y-px"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              <span>{formatDurationMinutes(duration.contentTime)}</span>
              <span>+</span>
              <BotMessageSquare className="w-3.5 h-3.5 inline ml-0.5" />
              <span>{formatDurationMinutes(duration.aiTime)}</span>
            </>
          ) : (
            <span>{formatDurationMinutes(duration.total)}</span>
          )}
        </div>
      ) : optional ? (
        <OptionalBadge />
      ) : null}
    </div>
  );
}
