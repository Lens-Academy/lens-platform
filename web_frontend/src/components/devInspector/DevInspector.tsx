import { useEffect, useState, useSyncExternalStore } from "react";
import {
  clearEntries,
  getEntries,
  subscribe,
  type InspectorEntry,
} from "./devInspectorStore";

/**
 * Floating dev-mode inspector for the in-course tutor.
 *
 * Renders nothing until the first `request_assembled` event arrives (which
 * only happens in non-production — the backend is the gate). Then shows a
 * floating button bottom-right. Clicking opens a drawer with the last N
 * assembled LLM requests.
 *
 * Purpose: let Lauren (or any dev) cross-check what the tutor is actually
 * sending, same lens as the Prompt Lab's Request Inspector but for the
 * real course UI.
 */
export default function DevInspector() {
  const entries = useSyncExternalStore(subscribe, getEntries, getEntries);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // When a new entry arrives while the drawer is open, auto-select it so
  // the view updates — otherwise the drawer still shows the old pinned one.
  useEffect(() => {
    if (open && entries.length > 0 && selectedId === null) {
      setSelectedId(entries[0].id);
    }
  }, [entries, open, selectedId]);

  if (entries.length === 0) return null;

  const selected =
    entries.find((e) => e.id === selectedId) ?? entries[0] ?? null;

  return (
    <>
      <button
        onClick={() => {
          setOpen(!open);
          if (!open && selectedId === null && entries.length > 0) {
            setSelectedId(entries[0].id);
          }
        }}
        className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white text-xs px-3 py-2 rounded-full shadow-lg hover:bg-slate-800 flex items-center gap-1"
        title="Dev Inspector — shows the last LLM requests the tutor made"
      >
        <span>🔍 Dev Inspector</span>
        <span className="bg-slate-700 px-1.5 py-0.5 rounded-full text-[10px]">
          {entries.length}
        </span>
      </button>

      {open && (
        <div className="fixed bottom-16 right-4 z-50 w-[900px] max-w-[90vw] h-[80vh] max-h-[900px] bg-white border border-slate-300 rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
            <span className="text-xs font-semibold text-slate-700">
              Dev Inspector
            </span>
            <span className="text-[10px] text-slate-500">
              Last {entries.length} tutor request{entries.length === 1 ? "" : "s"}
            </span>
            <button
              onClick={clearEntries}
              className="text-[10px] text-slate-500 hover:text-slate-700"
            >
              Clear
            </button>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto text-slate-400 hover:text-slate-600 text-sm"
            >
              &times;
            </button>
          </div>

          <div className="flex flex-1 min-h-0">
            <EntryList
              entries={entries}
              selectedId={selected?.id ?? null}
              onSelect={setSelectedId}
            />
            {selected && <EntryDetails entry={selected} />}
          </div>
        </div>
      )}
    </>
  );
}

function EntryList({
  entries,
  selectedId,
  onSelect,
}: {
  entries: InspectorEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="w-[240px] shrink-0 border-r border-slate-200 overflow-y-auto">
      {entries.map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString();
        const selected = e.id === selectedId;
        return (
          <button
            key={e.id}
            onClick={() => onSelect(e.id)}
            className={`block w-full text-left px-2 py-1.5 text-[11px] border-b border-slate-100 ${
              selected ? "bg-blue-50" : "hover:bg-slate-50"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-slate-400 font-mono">{time}</span>
              <span className="text-slate-700 truncate">
                {e.moduleId}/{e.sectionIndex}/{e.segmentIndex}
              </span>
            </div>
            {e.lastUserMessage && (
              <div className="text-slate-500 truncate mt-0.5">
                {e.lastUserMessage}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function EntryDetails({ entry }: { entry: InspectorEntry }) {
  const { payload } = entry;
  return (
    <div className="flex-1 overflow-y-auto p-3 text-[11px] font-mono text-slate-700 space-y-3">
      <Section label="system_prompt" body={payload.system_prompt} />
      <div>
        <div className="text-[10px] font-semibold text-slate-600 uppercase mb-1">
          llm_messages ({payload.llm_messages.length})
        </div>
        <div className="space-y-1">
          {payload.llm_messages.map((m, i) => (
            <details key={i} className="border border-slate-200 rounded">
              <summary className="cursor-pointer px-2 py-1 text-[10px] text-slate-500 bg-slate-50">
                {m.role} ({m.content?.length ?? 0} chars)
              </summary>
              <pre className="px-2 py-1 whitespace-pre-wrap break-words bg-white">
                {m.content}
              </pre>
            </details>
          ))}
        </div>
      </div>
      <Section
        label="llm_kwargs"
        body={JSON.stringify(payload.llm_kwargs, null, 2)}
      />
    </div>
  );
}

function Section({ label, body }: { label: string; body: string }) {
  return (
    <details className="border border-slate-200 rounded" open>
      <summary className="cursor-pointer px-2 py-1 text-[10px] font-semibold text-slate-600 uppercase bg-slate-50">
        {label}
      </summary>
      <pre className="px-2 py-1 whitespace-pre-wrap break-words bg-white">
        {body}
      </pre>
    </details>
  );
}
