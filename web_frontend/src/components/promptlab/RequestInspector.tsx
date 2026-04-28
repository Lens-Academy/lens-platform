import { useState, useEffect, useRef } from "react";
import {
  inspect,
  type InspectResponse,
  type ModelChoice,
  type TutorTurnRequest,
} from "@/api/promptlab";

/**
 * Shape of the override state a StageGroup owns. Each field, if non-null,
 * replaces the server's default assembly step. null means "inherit".
 */
export interface StageGroupOverrides {
  systemPromptOverride?: string | null;
  instructionsOverride?: string | null;
  contentContextOverride?: string | null;
  courseOverviewOverride?: string | null;
  basePromptOverride?: string | null;
  enableThinking?: boolean;
  effort?: string;
  model?: string | null;
}

interface Props {
  /** Everything the Inspector needs to resolve a ScenarioTurn on the server. */
  request: TutorTurnRequest;
  overrides: StageGroupOverrides;
  setOverrides: (
    update: (prev: StageGroupOverrides) => StageGroupOverrides,
  ) => void;
  /** Model list for the llm_kwargs selector. Optional — falls back to a
   * read-only model display if absent. */
  models?: ModelChoice[];
}

/**
 * Request Inspector — shows the assembled LLM request (system prompt,
 * content context, instructions, llm_messages, llm_kwargs) and lets the
 * facilitator toggle per-field overrides.
 *
 * Debounces 300ms before calling /inspect; keeps the last successful
 * response visible while a new one is pending to avoid UI flicker.
 */
export default function RequestInspector({
  request,
  overrides,
  setOverrides,
  models,
}: Props) {
  const [data, setData] = useState<InspectResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pendingRef = useRef<AbortController | null>(null);

  const requestKey = JSON.stringify(request);
  useEffect(() => {
    const handle = setTimeout(async () => {
      pendingRef.current?.abort();
      const ac = new AbortController();
      pendingRef.current = ac;
      setLoading(true);
      try {
        const resp = await inspect(request);
        if (!ac.signal.aborted) {
          setData(resp);
          setError(null);
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          // inspect() currently throws a generic "Failed to inspect tutor
          // request" — the backend's 404 / 400 detail is lost at that layer.
          // Surface whatever shows up here; the network tab has the details.
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
    // requestKey stringifies request to detect deep-equality changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const originLabel = data?.provenance?.scenario_origin ?? "(loading)";

  // Count active overrides so the collapsed Inspector summary tells the user
  // at a glance whether anything is being overridden. A plain summary line
  // hides that — fine for clean states, misleading when fields are dirty.
  const overrideFields: (keyof StageGroupOverrides)[] = [
    "systemPromptOverride",
    "instructionsOverride",
    "contentContextOverride",
    "courseOverviewOverride",
    "basePromptOverride",
  ];
  const overrideCount = overrideFields.filter(
    (k) => overrides[k] != null,
  ).length;

  return (
    <details className="sticky left-0 self-start w-[450px] border-b border-gray-100">
      <summary className="cursor-pointer px-3 py-2 text-[10px] font-semibold text-slate-600 bg-slate-50 select-none flex items-center gap-2">
        <span>Request Inspector</span>
        {overrideCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">
            {overrideCount} override{overrideCount === 1 ? "" : "s"}
          </span>
        )}
        {loading && <span className="text-slate-400">…</span>}
        {error && (
          <span className="text-red-500 font-normal truncate" title={error}>
            {error}
          </span>
        )}
      </summary>

      <div className="px-3 py-2 space-y-1 bg-white">
        <div className="text-[10px] text-slate-400 font-mono break-all">
          {originLabel}
        </div>

        <OverrideSection
          label="System prompt"
          provenance={data?.provenance?.system_prompt}
          readValue={data?.system_prompt ?? ""}
          overrideValue={overrides.systemPromptOverride ?? null}
          onOverride={(v) =>
            setOverrides((p) => ({ ...p, systemPromptOverride: v }))
          }
        />

        <OverrideSection
          label="Course overview"
          provenance={data?.provenance?.course_overview}
          readValue={data?.scenario.course_overview ?? ""}
          overrideValue={overrides.courseOverviewOverride ?? null}
          onOverride={(v) =>
            setOverrides((p) => ({ ...p, courseOverviewOverride: v }))
          }
        />

        <OverrideSection
          label="Instructions"
          provenance={data?.provenance?.instructions}
          readValue={data?.scenario.instructions ?? ""}
          overrideValue={overrides.instructionsOverride ?? null}
          onOverride={(v) =>
            setOverrides((p) => ({ ...p, instructionsOverride: v }))
          }
        />

        <OverrideSection
          label="Content context (<lens>…</lens>)"
          provenance={data?.provenance?.content_context_message}
          readValue={contentContextFromScenario(data)}
          overrideValue={overrides.contentContextOverride ?? null}
          onOverride={(v) =>
            setOverrides((p) => ({ ...p, contentContextOverride: v }))
          }
        />

        <MessagesSection messages={data?.llm_messages ?? []} />

        <KwargsSection
          kwargs={data?.llm_kwargs}
          overrides={overrides}
          setOverrides={setOverrides}
          models={models}
        />
      </div>
    </details>
  );
}

/**
 * Pull the content-context block from ScenarioTurn.system_messages_to_persist.
 * That list contains the <lens>…</lens> XML block build_scenario_turn
 * assembled for this turn (the production tutor also saves it there, as a
 * DB system message). Prefer the entry that contains a <lens tag; fall
 * back to the last entry. Empty if no fresh content-context this turn.
 */
function contentContextFromScenario(data: InspectResponse | null): string {
  if (!data) return "";
  const msgs = data.scenario.system_messages_to_persist;
  if (!msgs || msgs.length === 0) return "";
  const lensEntry = msgs.find((m) => m.includes("<lens"));
  return lensEntry ?? msgs[msgs.length - 1];
}

function OverrideSection({
  label,
  provenance,
  readValue,
  overrideValue,
  onOverride,
}: {
  label: string;
  provenance?: string;
  readValue: string;
  overrideValue: string | null;
  onOverride: (value: string | null) => void;
}) {
  const isOverridden = overrideValue !== null;
  const displayed = isOverridden ? (overrideValue ?? "") : readValue;
  const lineCount = Math.max(displayed.split("\n").length, 4);

  return (
    <details className="border border-slate-200 rounded">
      <summary className="cursor-pointer flex items-center gap-1 px-2 py-1 bg-slate-50 select-none">
        <span className="text-[10px] font-semibold text-slate-600">
          {label}
        </span>
        {isOverridden && (
          <span className="text-[9px] text-orange-600 font-medium">
            overridden
          </span>
        )}
        <span className="ml-auto text-[9px] text-slate-400">
          {displayed.length} chars
        </span>
      </summary>
      <div className="border-t border-slate-200">
        <div className="flex items-center gap-2 px-2 py-1 bg-slate-50/60 border-b border-slate-100">
          {provenance && (
            <span className="text-[9px] text-slate-400 italic truncate">
              {provenance}
            </span>
          )}
          <button
            onClick={(e) => {
              e.preventDefault();
              onOverride(isOverridden ? null : displayed);
            }}
            className="ml-auto text-[10px] text-blue-600 hover:text-blue-800"
          >
            {isOverridden ? "Reset" : "Override"}
          </button>
        </div>
        <textarea
          value={displayed}
          onChange={(e) => isOverridden && onOverride(e.target.value)}
          readOnly={!isOverridden}
          rows={lineCount}
          className="w-full p-2 text-[11px] font-mono text-slate-700 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500 whitespace-pre"
          spellCheck={false}
        />
      </div>
    </details>
  );
}

function MessagesSection({ messages }: { messages: { role: string; content: string }[] }) {
  return (
    <details className="border border-slate-200 rounded">
      <summary className="cursor-pointer flex items-center gap-1 px-2 py-1 bg-slate-50 select-none">
        <span className="text-[10px] font-semibold text-slate-600">
          llm_messages ({messages.length})
        </span>
      </summary>
      <div className="p-2 text-[11px] font-mono text-slate-700 space-y-2 border-t border-slate-200">
        {messages.map((m, i) => (
          <div key={i}>
            <div className="text-[9px] text-slate-400 uppercase">{m.role}</div>
            <pre className="whitespace-pre-wrap break-words">{m.content}</pre>
          </div>
        ))}
      </div>
    </details>
  );
}

function KwargsSection({
  kwargs,
  overrides,
  setOverrides,
  models,
}: {
  kwargs?: InspectResponse["llm_kwargs"];
  overrides: StageGroupOverrides;
  setOverrides: (
    update: (prev: StageGroupOverrides) => StageGroupOverrides,
  ) => void;
  models?: ModelChoice[];
}) {
  return (
    <div className="border border-slate-200 rounded p-2 flex flex-wrap items-center gap-3 text-[11px]">
      <span className="text-[10px] font-semibold text-slate-600">
        llm_kwargs
      </span>
      <label className="inline-flex items-center gap-1 text-slate-700">
        model:
        {models && models.length > 0 ? (
          <select
            value={overrides.model ?? kwargs?.model ?? ""}
            onChange={(e) =>
              setOverrides((p) => ({ ...p, model: e.target.value }))
            }
            className="border border-slate-200 rounded px-1 max-w-[180px]"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-mono">{kwargs?.model ?? "(inherit)"}</span>
        )}
      </label>
      <label className="inline-flex items-center gap-1 text-slate-700">
        <input
          type="checkbox"
          checked={overrides.enableThinking !== false}
          onChange={(e) =>
            setOverrides((p) => ({ ...p, enableThinking: e.target.checked }))
          }
        />
        thinking
      </label>
      <span className="text-slate-700">
        effort:{" "}
        <select
          value={overrides.effort ?? "low"}
          onChange={(e) =>
            setOverrides((p) => ({ ...p, effort: e.target.value }))
          }
          className="border border-slate-200 rounded px-1"
        >
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </span>
    </div>
  );
}
