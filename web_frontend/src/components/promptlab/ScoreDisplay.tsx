import type { ScoreResult } from "@/api/promptlab";

const SCORE_COLORS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-yellow-500",
  4: "bg-green-500",
  5: "bg-emerald-500",
};

const SCORE_BG: Record<number, string> = {
  1: "bg-red-50 border-red-200",
  2: "bg-orange-50 border-orange-200",
  3: "bg-yellow-50 border-yellow-200",
  4: "bg-green-50 border-green-200",
  5: "bg-emerald-50 border-emerald-200",
};

interface ScoreDisplayProps {
  result: ScoreResult;
}

export default function ScoreDisplay({ result }: ScoreDisplayProps) {
  const score = result.overall_score;
  const colorClass = SCORE_COLORS[score] || "bg-slate-400";
  const bgClass = SCORE_BG[score] || "bg-slate-50 border-slate-200";

  return (
    <div className={`rounded border p-2 space-y-2 ${bgClass}`}>
      {/* Score badge + reasoning */}
      <div className="flex items-start gap-2">
        <div
          className={`shrink-0 w-8 h-8 rounded-full ${colorClass} text-white flex items-center justify-center font-bold text-sm`}
        >
          {score}
        </div>
        <p className="text-[11px] text-slate-700 leading-relaxed">
          {result.reasoning}
        </p>
      </div>

      {/* Dimensions */}
      {result.dimensions && result.dimensions.length > 0 && (
        <div className="space-y-1">
          {result.dimensions.map((dim, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span
                className={`shrink-0 w-4 h-4 rounded-full ${SCORE_COLORS[dim.score] || "bg-slate-400"} text-white flex items-center justify-center font-bold text-[9px]`}
              >
                {dim.score}
              </span>
              <span className="font-medium text-slate-600">{dim.name}</span>
              {dim.note && (
                <span className="text-slate-400 truncate">{dim.note}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Key observations */}
      {result.key_observations && result.key_observations.length > 0 && (
        <ul className="text-[10px] text-slate-600 space-y-0.5 pl-3">
          {result.key_observations.map((obs, i) => (
            <li key={i} className="list-disc">
              {obs}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
