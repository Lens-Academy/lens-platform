import { useState, forwardRef, useImperativeHandle, useRef } from "react";
import { scoreAnswer, type ScoreResult } from "@/api/promptlab";
import ScoreDisplay from "./ScoreDisplay";

export interface AssessmentColumnHandle {
  score: () => Promise<void>;
}

interface AssessmentColumnProps {
  label: string;
  question: string;
  answer: string;
  baseSystemPrompt: string;
  assessmentInstructions: string;
}

const AssessmentColumn = forwardRef<
  AssessmentColumnHandle,
  AssessmentColumnProps
>(function AssessmentColumn(
  { label, question, answer, baseSystemPrompt, assessmentInstructions },
  ref,
) {
  const [scoreResult, setScoreResult] = useState<ScoreResult | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for stable access from imperative handle
  const baseSystemPromptRef = useRef(baseSystemPrompt);
  const instructionsRef = useRef(assessmentInstructions);
  baseSystemPromptRef.current = baseSystemPrompt;
  instructionsRef.current = assessmentInstructions;

  async function doScore() {
    setIsScoring(true);
    setError(null);
    try {
      const result = await scoreAnswer(
        baseSystemPromptRef.current,
        instructionsRef.current,
        question,
        answer,
      );
      setScoreResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setIsScoring(false);
    }
  }

  useImperativeHandle(ref, () => ({
    score: doScore,
  }));

  return (
    <div className="flex flex-col h-full w-[280px] min-w-[280px] border-r border-gray-200 last:border-r-0">
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/50">
        <span className="text-xs font-medium text-slate-600 truncate">
          {label}
        </span>
        <button
          onClick={doScore}
          disabled={isScoring}
          className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
            isScoring
              ? "bg-slate-100 text-slate-400 cursor-default"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {isScoring ? "Scoring..." : scoreResult ? "Re-score" : "Score"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-1.5 bg-red-50 text-[10px] text-red-600 flex items-center gap-1">
          <span className="truncate">
            {error.length > 80 ? "Scoring failed. Check console." : error}
          </span>
          <button
            onClick={() => setError(null)}
            className="text-red-400 hover:text-red-600 ml-auto shrink-0"
          >
            &times;
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Question */}
        <div className="bg-gray-100 text-gray-800 p-2 rounded">
          <div className="text-[10px] text-gray-400 mb-0.5">Question</div>
          <div className="text-[12px] whitespace-pre-wrap">{question}</div>
        </div>

        {/* Student answer */}
        <div className="bg-blue-50 text-gray-800 p-2 rounded">
          <div className="text-[10px] text-gray-400 mb-0.5">
            Student Answer
          </div>
          <div className="text-[12px] whitespace-pre-wrap">{answer}</div>
        </div>

        {/* Loading indicator */}
        {isScoring && (
          <div className="flex items-center gap-2 py-2">
            <div className="w-4 h-4 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
            <span className="text-[11px] text-slate-400">Scoring...</span>
          </div>
        )}

        {/* Score result */}
        {scoreResult && !isScoring && <ScoreDisplay result={scoreResult} />}
      </div>
    </div>
  );
});

export default AssessmentColumn;
