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

function formatDuration(wordCount?: number | null, videoSeconds?: number | null): string | null {
  const readingMinutes = wordCount ? Math.ceil(wordCount / 200) : 0;
  const videoMinutes = videoSeconds ? Math.ceil(videoSeconds / 60) : 0;
  const total = readingMinutes + videoMinutes;
  if (total === 0) return null;
  return `${total} min`;
}

export default function LensCard({
  title,
  tldr,
  targetType,
  wordCount,
  videoDurationSeconds,
  isCompleted,
  href,
}: LensCardProps) {
  const duration = formatDuration(wordCount, videoDurationSeconds);
  const icon = targetType === "module" ? "\u{1F4DA}" : "\u{1F4C4}";
  const iconBg =
    targetType === "module"
      ? "bg-indigo-500/15"
      : isCompleted
        ? "bg-emerald-500/15"
        : "bg-amber-700/15";

  const Tag = href ? "a" : "div";

  return (
    <Tag
      href={href}
      className={`flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 transition-colors hover:bg-gray-100 ${isCompleted ? "opacity-70" : ""} ${href ? "cursor-pointer" : ""}`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconBg}`}>
        <span className="text-sm">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-gray-800 truncate">{title}</div>
        {tldr && <div className="mt-0.5 text-xs text-gray-500 truncate">{tldr}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {duration && <span className="text-[10px] text-gray-400">{duration}</span>}
        {targetType === "lens" && (
          isCompleted ? (
            <div data-completed className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600">
              <span className="text-[10px] text-white">{"\u2713"}</span>
            </div>
          ) : (
            <div data-incomplete className="h-4 w-4 rounded-full border-[1.5px] border-gray-300" />
          )
        )}
        {targetType === "module" && <span className="text-xs text-gray-400">{"\u2192"}</span>}
      </div>
    </Tag>
  );
}
