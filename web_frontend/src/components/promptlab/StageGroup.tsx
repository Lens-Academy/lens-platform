import { useState, useMemo, useCallback, useRef } from "react";
import ConversationColumn from "./ConversationColumn";
import type { ConversationColumnHandle } from "./ConversationColumn";
import RequestInspector, {
  type StageGroupOverrides,
} from "./RequestInspector";
import type {
  FixtureSection,
  ModelChoice,
  TutorTurnRequest,
} from "@/api/promptlab";

/**
 * Source discriminator: how to obtain a ScenarioTurn on the server. The
 * frontend carries the identifying info (fixtureKey, moduleSlug, etc.) and
 * passes it through every tutor-turn + inspect call.
 *
 * live_module support lands in change 5 (F6) — this change (F1-F4) only
 * wires the fixture case, but the StageGroup shape is already source-
 * agnostic so change 5 just adds a new variant here.
 */
export type StageGroupSource =
  | {
      kind: "fixture";
      fixtureKey: string;
      fixtureSectionIndex: number;
      section: FixtureSection;
    }
  | {
      kind: "live_module";
      moduleSlug: string;
      sectionIndex: number;
      segmentIndex: number;
      courseSlug?: string;
      // Display-only — resolved from the server on mount.
      sectionTitle: string | null;
    };

interface StageGroupProps {
  source: StageGroupSource;
  stageKey: string;
  /** Default model for this stage group's Inspector. Just a seed — once the
   * Inspector mounts, it owns the model selection per-group. */
  model?: string;
  /** Full model list for the Inspector's model selector. */
  models?: ModelChoice[];
  onRemove: () => void;
  columnRefs: React.MutableRefObject<Map<string, ConversationColumnHandle>>;
}

export default function StageGroup({
  source,
  stageKey,
  model,
  models,
  onRemove,
  columnRefs,
}: StageGroupProps) {
  const [overrides, setOverrides] = useState<StageGroupOverrides>({
    enableThinking: true,
    effort: "low",
    systemPromptOverride: null,
    model: model ?? null,
  });

  // Build the TutorTurnRequest the backend will see (minus per-column messages).
  // This same object feeds the Inspector and each ConversationColumn's
  // runTutorTurn calls — one source of truth.
  const requestBase: Omit<TutorTurnRequest, "messages"> = useMemo(() => {
    const base: Omit<TutorTurnRequest, "messages"> = {
      scenarioSource: source.kind,
      basePromptOverride: overrides.basePromptOverride ?? null,
      systemPromptOverride: overrides.systemPromptOverride ?? null,
      instructionsOverride: overrides.instructionsOverride ?? null,
      contentContextOverride: overrides.contentContextOverride ?? null,
      courseOverviewOverride: overrides.courseOverviewOverride ?? null,
      enableThinking: overrides.enableThinking !== false,
      effort: overrides.effort ?? "low",
      model: overrides.model ?? null,
      enableTools: true,
    };
    if (source.kind === "fixture") {
      base.fixtureKey = source.fixtureKey;
      base.fixtureSectionIndex = source.fixtureSectionIndex;
    } else {
      base.moduleSlug = source.moduleSlug;
      base.sectionIndex = source.sectionIndex;
      base.segmentIndex = source.segmentIndex;
      base.courseSlug = source.courseSlug ?? null;
    }
    return base;
  }, [source, overrides]);

  const fixtureConversations = useMemo(() => {
    if (source.kind !== "fixture") return [];
    return source.section.conversations.map((c) => ({
      label: c.label,
      messages: c.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    }));
  }, [source]);

  // Live-module stage groups have no pre-loaded conversations; seed one
  // empty column so the user immediately has somewhere to type. Fixture
  // groups get their columns from the fixture's conversations list.
  const [extraChats, setExtraChats] = useState<{ label: string }[]>(() =>
    source.kind === "live_module" ? [{ label: "Chat 1" }] : [],
  );
  const nextChatNum = useRef(source.kind === "live_module" ? 2 : 1);

  const handleAddChat = useCallback(() => {
    const label = `Chat ${nextChatNum.current++}`;
    setExtraChats((prev) => [...prev, { label }]);
  }, []);

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
    source.kind === "fixture"
      ? `fixture: ${source.section.name}`
      : `live: ${source.moduleSlug} / ${source.sectionIndex} / ${source.segmentIndex}`;

  const columnBase: TutorTurnRequest = {
    ...requestBase,
    messages: [],
  };

  // Inspector needs a canonical request shape; use one representative
  // message list (the first fixture conversation, or empty for live/new).
  const inspectorMessages = fixtureConversations[0]?.messages ?? [];
  const inspectorRequest: TutorTurnRequest = {
    ...requestBase,
    messages: inspectorMessages,
  };

  return (
    <div className="shrink-0 h-full flex flex-col border-2 border-slate-300 rounded-lg bg-white">
      {/* Group header — sticky left */}
      <div className="sticky left-0 self-start w-[450px] flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 rounded-tl-lg">
        <h3 className="text-xs font-semibold text-slate-700 truncate">
          {source.kind === "fixture"
            ? source.section.name
            : (source.sectionTitle ?? source.moduleSlug)}
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

      {/* Request Inspector replaces the legacy Instructions + Context editors.
          Every field (system prompt, instructions, content context, course
          overview) is a section inside it, with an Override toggle. */}
      <RequestInspector
        request={inspectorRequest}
        overrides={overrides}
        setOverrides={setOverrides}
        models={models}
      />

      {/* Conversation columns */}
      <div className="flex flex-1 min-h-0">
        {fixtureConversations.map((conv) => (
          <ConversationColumn
            key={conv.label}
            ref={setColumnRef(conv.label)}
            initialMessages={conv.messages}
            label={conv.label}
            requestBase={columnBase}
          />
        ))}
        {extraChats.map((chat) => (
          <ConversationColumn
            key={chat.label}
            ref={setColumnRef(chat.label)}
            initialMessages={[]}
            label={chat.label}
            requestBase={columnBase}
            clearable
          />
        ))}
      </div>
    </div>
  );
}
