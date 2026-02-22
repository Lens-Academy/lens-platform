import { useState, useMemo, useCallback } from "react";
import ConversationColumn from "./ConversationColumn";
import type { ConversationColumnHandle } from "./ConversationColumn";
import type { FixtureSection } from "@/api/promptlab";
import { assemblePrompt } from "@/utils/assemblePrompt";

interface StageGroupProps {
  section: FixtureSection;
  stageKey: string;
  systemPrompt: string;
  enableThinking: boolean;
  effort: string;
  onRemove: () => void;
  columnRefs: React.MutableRefObject<Map<string, ConversationColumnHandle>>;
}

export default function StageGroup({
  section,
  stageKey,
  systemPrompt,
  enableThinking,
  effort,
  onRemove,
  columnRefs,
}: StageGroupProps) {
  const [instructions, setInstructions] = useState(section.instructions);
  const [context, setContext] = useState(section.context);
  const [contextExpanded, setContextExpanded] = useState(false);

  const fullPrompt = useMemo(
    () => assemblePrompt(systemPrompt, instructions, context),
    [systemPrompt, instructions, context],
  );

  const initialConversations = useMemo(
    () =>
      section.conversations.map((c) => ({
        label: c.label,
        messages: c.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      })),
    [section],
  );

  // Register column refs with globally-unique keys
  const setColumnRef = useCallback(
    (convLabel: string) => (handle: ConversationColumnHandle | null) => {
      const key = `${stageKey}::${convLabel}`;
      if (handle) {
        columnRefs.current.set(key, handle);
      } else {
        columnRefs.current.delete(key);
      }
    },
    [stageKey, columnRefs],
  );

  return (
    <div className="shrink-0 h-full flex flex-col border-2 border-slate-300 rounded-lg bg-white">
      {/* Group header — sticky left */}
      <div className="sticky left-0 self-start w-[350px] flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-tl-lg">
        <h3 className="text-xs font-semibold text-slate-700 truncate">{section.name}</h3>
        <span className="text-[10px] text-slate-400">{section.conversations.length} chats</span>
        <button
          onClick={onRemove}
          className="ml-auto text-slate-400 hover:text-slate-600 text-sm"
          aria-label="Remove stage group"
        >
          &times;
        </button>
      </div>

      {/* Instructions editor — sticky left */}
      <div className="sticky left-0 self-start w-[350px] px-3 py-2 border-b border-gray-100">
        <label className="text-[10px] font-medium text-slate-500 mb-1 block">Instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full border border-gray-200 rounded p-2 text-[11px] text-slate-700 resize-y min-h-[5rem] max-h-[10rem] focus:outline-none focus:ring-1 focus:ring-blue-500"
          spellCheck={false}
        />
      </div>

      {/* Context (collapsible) — sticky left */}
      <div className="sticky left-0 self-start w-[350px] px-3 py-1.5 border-b border-gray-100">
        <button
          onClick={() => setContextExpanded(!contextExpanded)}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
        >
          <svg
            className={`w-2.5 h-2.5 transition-transform ${contextExpanded ? "rotate-90" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Context
          {!contextExpanded && context && (
            <span className="text-slate-400 truncate max-w-[200px]">
              — {context.slice(0, 60)}...
            </span>
          )}
        </button>
        {contextExpanded && (
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            className="w-full mt-1 border border-gray-200 rounded p-2 text-[11px] text-slate-700 resize-y min-h-[3rem] max-h-[12rem] focus:outline-none focus:ring-1 focus:ring-blue-500"
            spellCheck={false}
          />
        )}
      </div>

      {/* Conversation columns */}
      <div className="flex flex-1 min-h-0">
        {initialConversations.map((conv) => (
          <ConversationColumn
            key={conv.label}
            ref={setColumnRef(conv.label)}
            initialMessages={conv.messages}
            label={conv.label}
            systemPrompt={fullPrompt}
            enableThinking={enableThinking}
            effort={effort}
          />
        ))}
      </div>
    </div>
  );
}
