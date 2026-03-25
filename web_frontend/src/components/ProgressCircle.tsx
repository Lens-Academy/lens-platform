/**
 * Circular progress indicator:
 * - not_started: gray outline ring
 * - current: amber-filled ring (no arc progress)
 * - in_progress: gray outline ring with amber arc fill (clock-style, starting at 12 o'clock)
 * - completed: filled orange circle with white checkmark
 */
export function ProgressCircle({
  status,
  completedLenses,
  totalLenses,
  size = 16,
  selected,
}: {
  status: "completed" | "in_progress" | "not_started" | "current";
  completedLenses?: number;
  totalLenses?: number;
  size?: number;
  selected?: boolean;
}) {
  if (status === "completed") {
    return (
      <svg
        className="flex-shrink-0"
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
      >
        <circle cx="10" cy="10" r="9" fill="var(--color-lens-gold-400)" />
        <path
          d="M6 10.5l2.5 2.5 5-5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    );
  }

  if (status === "current" || status === "in_progress") {
    const r = 8;
    const cx = 10;
    const cy = 10;
    const circumference = 2 * Math.PI * r;
    const fraction =
      status === "in_progress" && totalLenses && totalLenses > 0
        ? Math.min((completedLenses ?? 0) / totalLenses, 1)
        : 0;

    return (
      <svg
        className="flex-shrink-0"
        width={size}
        height={size}
        viewBox="0 0 20 20"
        fill="none"
        style={fraction > 0 ? { transform: "rotate(-90deg)" } : undefined}
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={
            fraction > 0 ? (selected ? "#94a3b8" : "#cbd5e1") : "var(--color-lens-gold-400)"
          }
          strokeWidth="2"
          fill={fraction > 0 ? "none" : "#fde8c8"}
        />
        {fraction > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            stroke="var(--color-lens-gold-400)"
            strokeWidth="2"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            strokeLinecap="round"
          />
        )}
      </svg>
    );
  }

  return (
    <svg
      className="flex-shrink-0"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke={selected ? "#94a3b8" : "#ccc"}
        strokeWidth="2"
        fill="white"
      />
    </svg>
  );
}
