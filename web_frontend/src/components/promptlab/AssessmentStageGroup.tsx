import { useState, useCallback } from "react";
import AssessmentColumn from "./AssessmentColumn";
import type { AssessmentColumnHandle } from "./AssessmentColumn";
import type { AssessmentSection } from "@/api/promptlab";

const MAX_CONCURRENT_SCORES = 10;

interface AssessmentStageGroupProps {
  section: AssessmentSection;
  stageKey: string;
  systemPrompt: string;
  onRemove: () => void;
  columnRefs: React.MutableRefObject<Map<string, AssessmentColumnHandle>>;
}

export default function AssessmentStageGroup({
  section,
  stageKey,
  systemPrompt,
  onRemove,
  columnRefs,
}: AssessmentStageGroupProps) {
  const [instructions, setInstructions] = useState(section.instructions);

  // Register column refs with globally-unique keys
  const setColumnRef = useCallback(
    (itemLabel: string) => (handle: AssessmentColumnHandle | null) => {
      const key = `${stageKey}::${itemLabel}`;
      if (handle) {
        columnRefs.current.set(key, handle);
      } else {
        columnRefs.current.delete(key);
      }
    },
    [stageKey, columnRefs],
  );

  const handleScoreAll = useCallback(async () => {
    const columns: AssessmentColumnHandle[] = [];
    for (const [key, handle] of columnRefs.current) {
      if (key.startsWith(`${stageKey}::`)) {
        columns.push(handle);
      }
    }

    // Score with concurrency cap
    const queue = [...columns];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < MAX_CONCURRENT_SCORES && queue.length > 0) {
        const col = queue.shift()!;
        const p = col
          .score()
          .catch(() => {})
          .finally(() => {
            active.splice(active.indexOf(p), 1);
          });
        active.push(p);
      }
      if (active.length > 0) {
        await Promise.race(active);
      }
    }
  }, [stageKey, columnRefs]);

  return (
    <div className="shrink-0 h-full flex flex-col border-2 border-slate-300 rounded-lg bg-white">
      {/* Group header */}
      <div className="sticky left-0 self-start w-[450px] flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-tl-lg">
        <h3 className="text-xs font-semibold text-slate-700 truncate">
          {section.name}
        </h3>
        <span className="text-[10px] text-slate-400">
          {section.items.length} items
        </span>
        <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
          Assessment
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={handleScoreAll}
            className="text-[10px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            Score All
          </button>
          <button
            onClick={onRemove}
            className="text-slate-400 hover:text-slate-600 text-sm"
            aria-label="Remove stage group"
          >
            &times;
          </button>
        </div>
      </div>

      {/* Rubric editor */}
      <div className="sticky left-0 self-start w-[450px] px-3 py-2 border-b border-gray-100">
        <label className="text-[10px] font-medium text-slate-500 mb-1 block">
          Assessment Rubric
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full border border-gray-200 rounded p-2 text-[11px] text-slate-700 resize-y min-h-[5rem] max-h-[10rem] focus:outline-none focus:ring-1 focus:ring-blue-500"
          spellCheck={false}
        />
      </div>

      {/* Assessment columns */}
      <div className="flex flex-1 min-h-0">
        {section.items.map((item) => (
          <AssessmentColumn
            key={item.label}
            ref={setColumnRef(item.label)}
            label={item.label}
            question={item.question}
            answer={item.answer}
            baseSystemPrompt={systemPrompt}
            assessmentInstructions={instructions}
          />
        ))}
      </div>
    </div>
  );
}
