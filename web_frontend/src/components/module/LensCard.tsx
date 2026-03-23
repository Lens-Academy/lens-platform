import { StageIcon } from "./StageProgressBar";

type LensCardProps = {
  title: string;
  tldr?: string | null;
  targetType: "lens" | "module";
  displayType?: string | null;
  contentId?: string | null;
  slug?: string | null;
  wordCount?: number | null;
  videoDurationSeconds?: number | null;
  moduleSlug?: string | null;
  isCompleted?: boolean;
  href?: string;
};

function formatDuration(
  wordCount?: number | null,
  videoSeconds?: number | null,
): string | null {
  const readingMinutes = wordCount ? Math.ceil(wordCount / 200) : 0;
  const videoMinutes = videoSeconds ? Math.ceil(videoSeconds / 60) : 0;
  const total = readingMinutes + videoMinutes;
  if (total === 0) return null;
  return `${total} min`;
}

/** Map displayType to the stage type expected by StageIcon */
function getIconType(
  targetType: "lens" | "module",
  displayType?: string | null,
): string {
  if (targetType === "module") return "lens";
  if (displayType === "lens-video") return "lens";
  if (displayType === "lens-article") return "lens";
  return "lens"; // default — StageIcon handles lens with displayType
}

export default function LensCard({
  title,
  tldr,
  targetType,
  displayType,
  wordCount,
  videoDurationSeconds,
  isCompleted,
  href,
}: LensCardProps) {
  const duration = formatDuration(wordCount, videoDurationSeconds);

  // Use the same color scheme as the progress bar dots
  const dotClasses = isCompleted
    ? "bg-lens-gold-400 text-white"
    : "bg-gray-200 text-gray-400";

  const Tag = href ? "a" : "div";

  return (
    <Tag
      href={href}
      className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 transition-colors hover:bg-gray-100 ${isCompleted ? "opacity-70" : ""} ${href ? "cursor-pointer" : ""}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${dotClasses}`}
      >
        <StageIcon
          type={getIconType(targetType, displayType)}
          displayType={displayType ?? undefined}
          small
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-800 truncate">
          {title}
        </div>
        {tldr && (
          <div className="mt-0.5 text-xs text-gray-500 truncate">{tldr}</div>
        )}
      </div>
      {duration && (
        <span className="shrink-0 text-[10px] text-gray-400">{duration}</span>
      )}
    </Tag>
  );
}
