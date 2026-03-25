import { StageCircle } from "../StageCircle";
import { ProgressCircle } from "../ProgressCircle";

type LensCardProps = {
  title: string;
  tldr?: string | null;
  targetType: "lens" | "module";
  displayType?: string | null;
  contentId?: string | null;
  slug?: string | null;
  moduleSlug?: string | null;
  isCompleted?: boolean;
  href?: string;
  duration?: string | null;
  attribution?: string | null;
  moduleStatus?: "completed" | "in_progress" | "not_started";
  moduleCompletedLenses?: number;
  moduleTotalLenses?: number;
};

export default function LensCard({
  title,
  tldr,
  targetType,
  displayType,
  isCompleted,
  href,
  duration,
  attribution,
  moduleStatus,
  moduleCompletedLenses,
  moduleTotalLenses,
}: LensCardProps) {
  const isModule = targetType === "module";

  const Tag = href ? "a" : "div";

  return (
    <Tag
      href={href}
      className="no-underline my-2 flex items-center gap-3.5 rounded-2xl bg-white px-4 py-3.5 border border-gray-200/60 shadow-sm hover:shadow-md transition-shadow"
    >
      {isModule ? (
        <ProgressCircle
          status={moduleStatus ?? "not_started"}
          completedLenses={moduleCompletedLenses}
          totalLenses={moduleTotalLenses}
          size={32}
        />
      ) : (
        <StageCircle type="lens" displayType={displayType ?? undefined} isCompleted={isCompleted ?? false} size={32} />
      )}
      <div className="not-prose min-w-0 flex-1 font-normal">
        <div className="font-display text-[17px] leading-snug text-slate-900">
          {title}
        </div>
        {attribution && (
          <div className="text-sm text-slate-600 italic truncate">{attribution}</div>
        )}
        {tldr && (
          <div className="mt-0.5 text-sm text-slate-600">{tldr}</div>
        )}
      </div>
      {duration && (
        <span className="shrink-0 text-sm text-slate-500">{duration}</span>
      )}
    </Tag>
  );
}
