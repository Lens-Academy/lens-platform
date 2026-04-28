import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import ConversationColumn from "./ConversationColumn";
import type { ConversationColumnHandle } from "./ConversationColumn";
import RequestInspector, {
  type StageGroupOverrides,
} from "./RequestInspector";
import type {
  FixtureChat,
  FixtureMessage,
  ModelChoice,
  StageGroupOverridesV2,
  StageGroupV2,
  TutorTurnRequest,
} from "@/api/promptlab";

/**
 * The Inspector edits StageGroupOverrides (live, in-memory, with `Override`
 * suffix on text fields). The fixture file persists StageGroupOverridesV2
 * (no suffix). These translate between the two — small adapter so we don't
 * have to rename Inspector field names everywhere.
 */
function v2ToInspectorOverrides(
  o: StageGroupOverridesV2,
): StageGroupOverrides {
  return {
    systemPromptOverride: o.systemPrompt ?? null,
    basePromptOverride: o.basePrompt ?? null,
    instructionsOverride: o.instructions ?? null,
    contentContextOverride: o.contentContext ?? null,
    courseOverviewOverride: o.courseOverview ?? null,
    model: o.model ?? null,
    enableThinking: o.thinking ?? true,
    effort: o.effort ?? "low",
  };
}

function inspectorToV2Overrides(
  o: StageGroupOverrides,
): StageGroupOverridesV2 {
  const out: StageGroupOverridesV2 = {};
  if (o.systemPromptOverride != null) out.systemPrompt = o.systemPromptOverride;
  if (o.basePromptOverride != null) out.basePrompt = o.basePromptOverride;
  if (o.instructionsOverride != null) out.instructions = o.instructionsOverride;
  if (o.contentContextOverride != null)
    out.contentContext = o.contentContextOverride;
  if (o.courseOverviewOverride != null)
    out.courseOverview = o.courseOverviewOverride;
  if (o.model != null) out.model = o.model;
  if (o.enableThinking !== undefined && o.enableThinking !== true)
    out.thinking = o.enableThinking;
  if (o.effort && o.effort !== "low") out.effort = o.effort;
  return out;
}

interface StageGroupProps {
  stageGroup: StageGroupV2;
  /** Mutator: applied immutably. PromptLab uses this to write back into
   * the v2 fixture state on every stage-group-level change (overrides,
   * chat messages). Save is auto-triggered by the PromptLab effect. */
  setStageGroup: (updater: (sg: StageGroupV2) => StageGroupV2) => void;
  stageKey: string;
  /** Default model for newly-added stage groups. Seeds the Inspector
   * if stageGroup.overrides.model is not set. */
  model?: string;
  /** Full model list for the Inspector's model selector. */
  models?: ModelChoice[];
  /** Page-level base prompt override, shared across every stage group. The
   * group's own basePrompt override takes precedence when set. */
  globalBasePromptOverride?: string | null;
  onRemove: () => void;
  columnRefs: React.MutableRefObject<Map<string, ConversationColumnHandle>>;
}

export default function StageGroup({
  stageGroup,
  setStageGroup,
  stageKey,
  model,
  models,
  globalBasePromptOverride = null,
  onRemove,
  columnRefs,
}: StageGroupProps) {
  // Inspector state seeds from the persisted v2 overrides on this stage
  // group; on every change, sync back to the fixture so the auto-save
  // loop catches it.
  const [overrides, setOverridesLocal] = useState<StageGroupOverrides>(() => {
    const seeded = v2ToInspectorOverrides(stageGroup.overrides);
    if (seeded.model == null && model) seeded.model = model;
    return seeded;
  });
  const setOverrides = useCallback(
    (
      update:
        | StageGroupOverrides
        | ((prev: StageGroupOverrides) => StageGroupOverrides),
    ) => {
      setOverridesLocal((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        // Sync up to fixture state. Skip if effectively unchanged to avoid
        // infinite save loops (deep comparison via JSON, the override map
        // is tiny so this is cheap).
        const v2 = inspectorToV2Overrides(next);
        if (JSON.stringify(v2) !== JSON.stringify(stageGroup.overrides)) {
          setStageGroup((sg) => ({ ...sg, overrides: v2 }));
        }
        return next;
      });
    },
    [stageGroup.overrides, setStageGroup],
  );

  // Build the TutorTurnRequest minus per-column messages. Drives Inspector
  // and every ConversationColumn's runTutorTurn calls.
  const requestBase: Omit<TutorTurnRequest, "messages"> = useMemo(() => {
    const base: Omit<TutorTurnRequest, "messages"> = {
      // inline kind maps to the backend's "fixture" scenarioSource —
      // the v2 stage-group representation routes through the same code
      // path as legacy fixtures.
      scenarioSource: stageGroup.kind === "live_module" ? "live_module" : "fixture",
      basePromptOverride:
        overrides.basePromptOverride ?? globalBasePromptOverride ?? null,
      systemPromptOverride: overrides.systemPromptOverride ?? null,
      instructionsOverride: overrides.instructionsOverride ?? null,
      contentContextOverride: overrides.contentContextOverride ?? null,
      courseOverviewOverride: overrides.courseOverviewOverride ?? null,
      enableThinking: overrides.enableThinking !== false,
      effort: overrides.effort ?? "low",
      model: overrides.model ?? null,
      enableTools: true,
    };
    if (stageGroup.kind === "live_module") {
      base.moduleSlug = stageGroup.moduleSlug;
      base.sectionIndex = stageGroup.sectionIndex;
      base.segmentIndex = stageGroup.segmentIndex;
      base.courseSlug = stageGroup.courseSlug ?? null;
    } else {
      // inline kind: route through the fixture pipeline. The PromptLab is
      // the open fixture, so fixtureKey is the fixture name.
      base.scenarioSource = "fixture";
      // The fixture name is owned by PromptLab; it threads it through via
      // a per-column prop today, but for inline overrides we re-resolve
      // the matching stage-group index. Done at the column level via
      // requestBase override; here we leave fixture fields blank and rely
      // on PromptLab to set them upstream when needed. (jj-C deferral.)
    }
    return base;
  }, [stageGroup, overrides, globalBasePromptOverride]);

  // Chats live in the fixture. Render columns from stageGroup.chats; if
  // a live_module group has none yet, seed one in-fixture so the user
  // gets a typing surface.
  useEffect(() => {
    if (stageGroup.kind === "live_module" && stageGroup.chats.length === 0) {
      setStageGroup((sg) =>
        sg.kind === "live_module" && sg.chats.length === 0
          ? { ...sg, chats: [{ label: "Chat 1", messages: [] }] }
          : sg,
      );
    }
  }, [stageGroup.kind, stageGroup.chats.length, setStageGroup]);

  const nextChatNum = useRef(stageGroup.chats.length + 1);
  const handleAddChat = useCallback(() => {
    const label = `Chat ${nextChatNum.current++}`;
    setStageGroup((sg) => ({
      ...sg,
      chats: [...sg.chats, { label, messages: [] }],
    }));
  }, [setStageGroup]);

  /** Bubble per-column message changes up into stageGroup.chats[chatIndex]. */
  const handleChatMessages = useCallback(
    (chatIndex: number, messages: { role: string; content: string }[]) => {
      // ConversationColumn emits {role, content} as plain string roles;
      // FixtureMessage uses "user" | "assistant". Cast — the role literal
      // is well-formed at runtime since useConversationSlot only stores
      // those two values.
      const typedMessages: FixtureMessage[] = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      setStageGroup((sg) => {
        const next = sg.chats.slice();
        const cur = next[chatIndex];
        if (!cur) return sg;
        // Avoid no-op writes which would loop the autosave debounce.
        if (
          cur.messages.length === typedMessages.length &&
          cur.messages.every(
            (m, i) =>
              m.role === typedMessages[i].role &&
              m.content === typedMessages[i].content,
          )
        ) {
          return sg;
        }
        next[chatIndex] = { ...cur, messages: typedMessages };
        return { ...sg, chats: next };
      });
    },
    [setStageGroup],
  );

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

  const handleRegenerateSection = useCallback(async () => {
    const columns: ConversationColumnHandle[] = [];
    for (const [key, handle] of columnRefs.current) {
      if (key.startsWith(`${stageKey}::`)) {
        columns.push(handle);
      }
    }
    await Promise.all(
      columns.map((col) => col.regenerateLastAssistant().catch(() => {})),
    );
  }, [stageKey, columnRefs]);

  const sourceLabel =
    stageGroup.kind === "live_module"
      ? `live: ${stageGroup.moduleSlug} / ${stageGroup.sectionIndex} / ${stageGroup.segmentIndex}`
      : `inline: ${stageGroup.name ?? "(unnamed)"}`;

  const columnBase: TutorTurnRequest = {
    ...requestBase,
    messages: [],
  };

  // Inspector needs a canonical request shape — use the first chat's
  // messages so the resolved scenario reflects realistic state.
  const inspectorMessages: FixtureMessage[] =
    stageGroup.chats[0]?.messages ?? [];
  const inspectorRequest: TutorTurnRequest = {
    ...requestBase,
    messages: inspectorMessages,
  };

  const headerTitle =
    stageGroup.kind === "live_module"
      ? stageGroup.moduleSlug
      : (stageGroup.name ?? "Inline section");

  return (
    <div className="shrink-0 h-full flex flex-col border-2 border-slate-300 rounded-lg bg-white">
      {/* Group header — sticky left */}
      <div className="sticky left-0 self-start w-[450px] flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-tl-lg">
        <h3 className="text-xs font-semibold text-slate-700 truncate">
          {headerTitle}
        </h3>
        <span className="text-[9px] text-slate-400 font-mono truncate">
          {sourceLabel}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={handleAddChat}
            className="text-[10px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
          >
            + Chat
          </button>
          <button
            onClick={handleRegenerateSection}
            className="text-[10px] font-medium text-blue-600 hover:text-blue-800 transition-colors"
          >
            Regenerate all
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

      <RequestInspector
        request={inspectorRequest}
        overrides={overrides}
        setOverrides={setOverrides}
        models={models}
      />

      {/* Conversation columns */}
      <div className="flex flex-1 min-h-0">
        {stageGroup.chats.map((chat: FixtureChat, idx: number) => (
          <ConversationColumn
            key={chat.label}
            ref={setColumnRef(chat.label)}
            initialMessages={chat.messages}
            label={chat.label}
            requestBase={columnBase}
            clearable
            onMessagesChange={(msgs) => handleChatMessages(idx, msgs)}
          />
        ))}
      </div>
    </div>
  );
}
