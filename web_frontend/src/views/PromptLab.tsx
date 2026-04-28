import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import FixtureBrowser from "@/components/promptlab/FixtureBrowser";
import StageGroup from "@/components/promptlab/StageGroup";
import AssessmentStageGroup from "@/components/promptlab/AssessmentStageGroup";
import FixturePicker from "@/components/promptlab/FixturePicker";
import LiveModulePicker, {
  type LiveModuleSource,
} from "@/components/promptlab/LiveModulePicker";
import type { ConversationColumnHandle } from "@/components/promptlab/ConversationColumn";
import type { AssessmentColumnHandle } from "@/components/promptlab/AssessmentColumn";
import {
  getConfig,
  isAssessmentFixture,
  type Fixture,
  type AssessmentFixture,
  type FixtureSection,
  type AssessmentSection,
  type ModelChoice,
} from "@/api/promptlab";

/**
 * A stage group loaded into the grid. Three variants:
 * - `chat`: fixture-sourced chat (existing).
 * - `assessment`: fixture-sourced assessment (existing, uses AssessmentStageGroup).
 * - `live_module`: synthesized from a live module via build_scenario_turn.
 */
type LoadedStage =
  | {
      type: "chat";
      fixtureKey: string;
      sectionIndex: number;
      section: FixtureSection;
    }
  | {
      type: "assessment";
      fixtureKey: string;
      sectionIndex: number;
      section: AssessmentSection;
    }
  | {
      type: "live_module";
      /** Stable key for React list rendering. */
      id: string;
      moduleSlug: string;
      sectionIndex: number;
      segmentIndex: number;
      courseSlug?: string;
    };

const MAX_CONCURRENT_REGENERATIONS = 10;

/** Unique key for a LoadedStage — used as React key and as the prefix for
 * this group's ConversationColumn refs in columnRefsMap. */
function stageKeyOf(stage: LoadedStage): string {
  if (stage.type === "live_module") {
    return `live::${stage.id}`;
  }
  return `${stage.fixtureKey}::${stage.section.name}`;
}

export default function PromptLab() {
  const { isAuthenticated, isLoading, login } = useAuth();

  const [models, setModels] = useState<ModelChoice[]>([]);
  /** Default model seed for newly-added stage groups. Each Inspector owns
   * its own model after that — this value doesn't propagate to existing
   * groups when changed. */
  const [defaultModel, setDefaultModel] = useState<string>("");
  /** Production tutor's base prompt — read-only display value used as the
   * placeholder in the global override sidebar. Loaded once at mount. */
  const [defaultBasePrompt, setDefaultBasePrompt] = useState<string>("");
  /** Page-level base-prompt override. When non-null, every stage group uses
   * this as its base_prompt unless its own group-level override is set. */
  const [globalBasePromptOverride, setGlobalBasePromptOverride] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    getConfig()
      .then((cfg) => {
        setModels(cfg.models);
        setDefaultModel(cfg.defaultModel);
        setDefaultBasePrompt(cfg.defaultBasePrompt);
      })
      .catch((err) => {
        console.error("Failed to load promptlab config:", err);
      });
  }, [isAuthenticated]);

  const [stages, setStages] = useState<LoadedStage[]>([]);
  const [loadedFixtureNames, setLoadedFixtureNames] = useState<string[]>([]);
  /** Which "+ Add" flow is visible, or null for closed. `choose` is the top-level
   * menu; `fixture` / `live_module` are the two pickers. */
  const [pickerState, setPickerState] = useState<
    "choose" | "fixture" | "live_module" | null
  >(null);

  const columnRefsMap = useRef<Map<string, ConversationColumnHandle>>(
    new Map(),
  );
  const assessmentRefsMap = useRef<Map<string, AssessmentColumnHandle>>(
    new Map(),
  );

  const nextLiveIdRef = useRef(1);

  const handleAddFixture = useCallback(
    (fixture: Fixture | AssessmentFixture) => {
      setLoadedFixtureNames((prev) => {
        if (prev.includes(fixture.name)) return prev;
        return [...prev, fixture.name];
      });

      if (isAssessmentFixture(fixture)) {
        setStages((prev) => {
          if (prev.some((s) => s.type === "assessment" && s.fixtureKey === fixture.name))
            return prev;
          const newStages: LoadedStage[] = fixture.sections.map(
            (section, i) => ({
              type: "assessment" as const,
              fixtureKey: fixture.name,
              sectionIndex: i,
              section,
            }),
          );
          return [...prev, ...newStages];
        });
      } else {
        setStages((prev) => {
          if (prev.some((s) => s.type === "chat" && s.fixtureKey === fixture.name))
            return prev;
          const newStages: LoadedStage[] = fixture.sections.map(
            (section, i) => ({
              type: "chat" as const,
              fixtureKey: fixture.name,
              sectionIndex: i,
              section,
            }),
          );
          return [...prev, ...newStages];
        });
      }
      setPickerState(null);
    },
    [],
  );

  const handleAddLiveModule = useCallback((source: LiveModuleSource) => {
    setStages((prev) => [
      ...prev,
      {
        type: "live_module" as const,
        id: `${source.moduleSlug}-${source.sectionIndex}-${source.segmentIndex}-${nextLiveIdRef.current++}`,
        moduleSlug: source.moduleSlug,
        sectionIndex: source.sectionIndex,
        segmentIndex: source.segmentIndex,
        courseSlug: source.courseSlug,
      },
    ]);
    setPickerState(null);
  }, []);

  const handleRemoveStage = useCallback((key: string) => {
    setStages((prev) => {
      const next = prev.filter((s) => stageKeyOf(s) !== key);
      const remainingFixtures = new Set(
        next
          .filter((s): s is Exclude<LoadedStage, { type: "live_module" }> =>
            s.type !== "live_module",
          )
          .map((s) => s.fixtureKey),
      );
      setLoadedFixtureNames((names) =>
        names.filter((n) => remainingFixtures.has(n)),
      );
      return next;
    });
  }, []);

  const [regenSummary, setRegenSummary] = useState<string | null>(null);
  const regenSummaryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(
    () => () => {
      if (regenSummaryTimeoutRef.current)
        clearTimeout(regenSummaryTimeoutRef.current);
    },
    [],
  );

  const hasChatStages = stages.some(
    (s) => s.type === "chat" || s.type === "live_module",
  );
  const hasAssessmentStages = stages.some((s) => s.type === "assessment");

  const handleRegenerateAll = useCallback(async () => {
    const columns = Array.from(columnRefsMap.current.values());
    if (columns.length === 0) return;

    setRegenSummary(null);
    if (regenSummaryTimeoutRef.current)
      clearTimeout(regenSummaryTimeoutRef.current);

    let succeeded = 0;
    let failed = 0;
    const total = columns.length;
    const queue = [...columns];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < MAX_CONCURRENT_REGENERATIONS && queue.length > 0) {
        const col = queue.shift()!;
        const p = col
          .regenerateLastAssistant()
          .then(() => {
            succeeded++;
          })
          .catch(() => {
            failed++;
          })
          .finally(() => {
            active.splice(active.indexOf(p), 1);
          });
        active.push(p);
      }
      if (active.length > 0) {
        await Promise.race(active);
      }
    }

    if (failed > 0) {
      setRegenSummary(`Regenerated ${succeeded}/${total} (${failed} failed)`);
    } else {
      setRegenSummary(`Regenerated ${succeeded}/${total}`);
    }
    regenSummaryTimeoutRef.current = setTimeout(
      () => setRegenSummary(null),
      5000,
    );
  }, []);

  const handleScoreAll = useCallback(async () => {
    const columns = Array.from(assessmentRefsMap.current.values());
    if (columns.length === 0) return;

    setRegenSummary(null);
    if (regenSummaryTimeoutRef.current)
      clearTimeout(regenSummaryTimeoutRef.current);

    let succeeded = 0;
    let failed = 0;
    const total = columns.length;
    const queue = [...columns];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < MAX_CONCURRENT_REGENERATIONS && queue.length > 0) {
        const col = queue.shift()!;
        const p = col
          .score()
          .then(() => {
            succeeded++;
          })
          .catch(() => {
            failed++;
          })
          .finally(() => {
            active.splice(active.indexOf(p), 1);
          });
        active.push(p);
      }
      if (active.length > 0) {
        await Promise.race(active);
      }
    }

    if (failed > 0) {
      setRegenSummary(`Scored ${succeeded}/${total} (${failed} failed)`);
    } else {
      setRegenSummary(`Scored ${succeeded}/${total}`);
    }
    regenSummaryTimeoutRef.current = setTimeout(
      () => setRegenSummary(null),
      5000,
    );
  }, []);

  // --- Auth gates ---

  if (isLoading) {
    return (
      <div className="py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-stone-200 rounded" />
          <div className="h-4 w-64 bg-stone-200 rounded" />
          <div className="h-32 bg-stone-200 rounded" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="py-8">
        <h1 className="text-2xl font-bold mb-4">Prompt Lab</h1>
        <p className="mb-4 text-slate-600">
          Please sign in to access the Prompt Lab.
        </p>
        <button
          onClick={login}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Sign in with Discord
        </button>
      </div>
    );
  }

  const defaultModelDropdown = models.length > 0 && (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      Default model
      <select
        value={defaultModel}
        onChange={(e) => setDefaultModel(e.target.value)}
        className="border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white"
        title="Seed for newly-added stage groups. Each group's Inspector owns its own model after creation."
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );

  const addMenu = (
    <div className="relative">
      <button
        onClick={() =>
          setPickerState(pickerState === null ? "choose" : null)
        }
        className="text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1.5 rounded hover:bg-slate-200 transition-colors"
      >
        + Add
      </button>
      {pickerState === "choose" && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-white border border-slate-300 rounded-lg shadow-lg overflow-hidden w-[220px]">
          <button
            onClick={() => setPickerState("live_module")}
            className="block w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 border-b border-slate-100"
          >
            <div className="font-medium">From live module…</div>
            <div className="text-[10px] text-slate-500">
              Real course content through the production tutor pipeline.
            </div>
          </button>
          <button
            onClick={() => setPickerState("fixture")}
            className="block w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
          >
            <div className="font-medium">From fixture…</div>
            <div className="text-[10px] text-slate-500">
              Saved conversation snapshot.
            </div>
          </button>
        </div>
      )}
      {pickerState === "fixture" && (
        <div className="absolute right-0 top-full mt-1 z-10">
          <FixturePicker
            loadedFixtureNames={loadedFixtureNames}
            onSelect={handleAddFixture}
            onClose={() => setPickerState(null)}
          />
        </div>
      )}
      {pickerState === "live_module" && (
        <div className="absolute right-0 top-full mt-1 z-10">
          <LiveModulePicker
            onAdd={(source) => {
              handleAddLiveModule(source);
              setPickerState(null);
            }}
            onCancel={() => setPickerState(null)}
          />
        </div>
      )}
    </div>
  );

  // --- Empty state: show fixture browser + live-module button ---

  if (stages.length === 0) {
    return (
      <div className="py-4">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-xl font-bold text-[var(--brand-text)]">
            Prompt Lab
          </h1>
          <span className="text-sm text-slate-300">|</span>
          {defaultModelDropdown}
          <div className="ml-auto">{addMenu}</div>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Add a fixture for saved conversation snapshots, or a live module to
          run the production tutor pipeline against real course content.
          Every stage group flows through the same pipeline — fixtures don't
          drift from the live tutor.
        </p>
        <FixtureBrowser onSelectFixture={handleAddFixture} />
      </div>
    );
  }

  // --- Multi-conversation grid ---

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 7rem)" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 py-2 shrink-0">
        <span className="text-sm font-semibold text-slate-800">Prompt Lab</span>
        <span className="text-sm text-slate-300">|</span>
        <button
          onClick={() => {
            setStages([]);
            columnRefsMap.current.clear();
            assessmentRefsMap.current.clear();
          }}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          Clear all
        </button>
        <span className="text-sm text-slate-300">|</span>
        {defaultModelDropdown}

        <div className="ml-auto flex items-center gap-2 relative">
          {regenSummary && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
              {regenSummary}
            </span>
          )}
          {hasChatStages && (
            <button
              onClick={handleRegenerateAll}
              className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
            >
              Regenerate all
            </button>
          )}
          {hasAssessmentStages && (
            <button
              onClick={handleScoreAll}
              className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
            >
              Score all
            </button>
          )}
          {addMenu}
        </div>
      </div>

      {/* Sidebar (global overrides) + horizontal scroll grid of stage groups */}
      <div className="flex flex-1 min-h-0 gap-3">
        <GlobalOverridesSidebar
          defaultBasePrompt={defaultBasePrompt}
          basePromptOverride={globalBasePromptOverride}
          setBasePromptOverride={setGlobalBasePromptOverride}
        />
        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 h-full">
            {stages.map((stage) => {
            const key = stageKeyOf(stage);
            if (stage.type === "assessment") {
              return (
                <AssessmentStageGroup
                  key={key}
                  section={stage.section}
                  stageKey={key}
                  systemPrompt=""
                  model={defaultModel}
                  onRemove={() => handleRemoveStage(key)}
                  columnRefs={assessmentRefsMap}
                />
              );
            }
            if (stage.type === "live_module") {
              return (
                <StageGroup
                  key={key}
                  source={{
                    kind: "live_module",
                    moduleSlug: stage.moduleSlug,
                    sectionIndex: stage.sectionIndex,
                    segmentIndex: stage.segmentIndex,
                    courseSlug: stage.courseSlug,
                    sectionTitle: null,
                  }}
                  stageKey={key}
                  model={defaultModel}
                  models={models}
                  globalBasePromptOverride={globalBasePromptOverride}
                  onRemove={() => handleRemoveStage(key)}
                  columnRefs={columnRefsMap}
                />
              );
            }
            return (
              <StageGroup
                key={key}
                source={{
                  kind: "fixture",
                  fixtureKey: stage.fixtureKey,
                  fixtureSectionIndex: stage.sectionIndex,
                  section: stage.section,
                }}
                stageKey={key}
                model={defaultModel}
                globalBasePromptOverride={globalBasePromptOverride}
                onRemove={() => handleRemoveStage(key)}
                columnRefs={columnRefsMap}
              />
            );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Sidebar pinned to the left of the stage-group grid. Owns the page-level
 * base-prompt override — when set, every stage group inherits it as its
 * `basePromptOverride` unless the group has its own group-level override.
 *
 * The textarea seeds with DEFAULT_BASE_PROMPT (read-only) until the user
 * clicks Override; from that point the value lives in the parent state.
 */
function GlobalOverridesSidebar({
  defaultBasePrompt,
  basePromptOverride,
  setBasePromptOverride,
}: {
  defaultBasePrompt: string;
  basePromptOverride: string | null;
  setBasePromptOverride: (v: string | null) => void;
}) {
  const isOverridden = basePromptOverride !== null;
  const displayed = isOverridden ? basePromptOverride : defaultBasePrompt;

  return (
    <aside className="shrink-0 w-[340px] border border-slate-200 rounded bg-white flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className="text-[11px] font-semibold text-slate-700">
          Global: Base Prompt
        </span>
        {isOverridden && (
          <span className="text-[9px] text-orange-600 font-medium">
            overridden
          </span>
        )}
        <button
          onClick={() =>
            setBasePromptOverride(isOverridden ? null : defaultBasePrompt)
          }
          className="ml-auto text-[10px] text-blue-600 hover:text-blue-800"
        >
          {isOverridden ? "Reset" : "Override"}
        </button>
      </div>
      <div className="px-3 py-1 text-[10px] text-slate-400 italic border-b border-slate-100">
        Shared across every stage group. Group-level overrides win.
      </div>
      <textarea
        value={displayed}
        onChange={(e) => isOverridden && setBasePromptOverride(e.target.value)}
        readOnly={!isOverridden}
        className="flex-1 p-2 text-[11px] font-mono text-slate-700 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 whitespace-pre-wrap"
        spellCheck={false}
      />
    </aside>
  );
}
