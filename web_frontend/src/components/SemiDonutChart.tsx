import { BookOpen, Play, Bot, UsersRound } from "lucide-react";

const ACTIVITIES = [
  { label: "Reading", hours: 1.5, color: "#f97316", icon: BookOpen },
  { label: "Watching", hours: 0.5, color: "#3b82f6", icon: Play },
  { label: "AI Tutor", hours: 1.5, color: "#10b981", icon: Bot },
  { label: "Group Meeting", hours: 1.5, color: "#8b5cf6", icon: UsersRound },
] as const;

const TOTAL_HOURS = 5;

export default function SemiDonutChart() {
  const r = 90;
  const strokeWidth = 28;
  const cx = 150;
  const cy = 140;
  const gap = 1.5;
  const halfCirc = Math.PI * r;
  const totalGap = gap * ACTIVITIES.length;
  const usableArc = halfCirc - totalGap;

  let offset = gap / 2;
  const segments = ACTIVITIES.map((act) => {
    const length = (act.hours / TOTAL_HOURS) * usableArc;
    const seg = { ...act, length, offset };
    offset += length + gap;
    return seg;
  });

  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 300 180"
        className="w-full max-w-xs sm:max-w-sm"
        aria-label="Weekly time distribution: Reading 1.5h, Watching 0.5h, AI Tutor 1.5h, Group Meeting 1.5h"
      >
        {/* Background track */}
        <path
          d={path}
          fill="none"
          stroke="var(--landing-border)"
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          opacity={0.4}
        />
        {/* Segments */}
        {segments.map((seg) => (
          <path
            key={seg.label}
            d={path}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={`${seg.length} ${halfCirc}`}
            strokeDashoffset={-seg.offset}
          />
        ))}
        {/* Icons outside segments */}
        {segments.map((seg) => {
          const midPos = seg.offset + seg.length / 2;
          const angle = Math.PI - midPos / r;
          const outerR = r + strokeWidth / 2 + 14;
          const ix = cx + outerR * Math.cos(angle);
          const iy = cy - outerR * Math.sin(angle);
          const iconSize = 16;
          return (
            <foreignObject
              key={`icon-${seg.label}`}
              x={ix - iconSize / 2}
              y={iy - iconSize / 2}
              width={iconSize}
              height={iconSize}
            >
              <seg.icon
                style={{ width: iconSize, height: iconSize, color: seg.color }}
                strokeWidth={2}
              />
            </foreignObject>
          );
        })}
        {/* Center text */}
        <text
          x={cx}
          y={cy - 20}
          textAnchor="middle"
          fontSize="32"
          fontWeight="700"
          fill="var(--landing-text)"
          style={{ fontFamily: "var(--landing-font-display)" }}
        >
          5 hrs
        </text>
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontSize="13"
          fill="var(--landing-text-muted)"
        >
          per week
        </text>
      </svg>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-4">
        {ACTIVITIES.map((act) => (
          <div key={act.label} className="flex items-center gap-2.5">
            <act.icon
              className="w-4 h-4 shrink-0"
              style={{ color: act.color }}
              strokeWidth={2}
            />
            <span
              className="text-sm"
              style={{ color: "var(--landing-text-muted)" }}
            >
              {act.label}
            </span>
            <span
              className="text-sm font-semibold ml-auto"
              style={{ color: "var(--landing-text)" }}
            >
              {act.hours}h
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
