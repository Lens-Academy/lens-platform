/**
 * Skeleton placeholder components for loading states.
 * Shows pulsing placeholders matching content structure.
 */

const cn = (...classes: (string | undefined | false)[]) =>
  classes.filter(Boolean).join(" ");

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
}

/**
 * Skeleton placeholder component for loading states.
 * Shows pulsing placeholder matching content structure.
 */
export function Skeleton({ className, variant = "text" }: SkeletonProps) {
  const baseClasses = "animate-pulse bg-slate-200 rounded";

  const variantClasses = {
    text: "h-4 w-full",
    circular: "rounded-full",
    rectangular: "rounded-md",
  };

  return (
    <div
      className={cn(baseClasses, variantClasses[variant], className)}
      aria-hidden="true"
    />
  );
}

/**
 * Skeleton group for content sections.
 * Shows multiple lines to approximate text blocks.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
}
