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
  loadFixture as apiLoadFixture,
  saveFixture,
  type Fixture,
  type AssessmentFixture,
  type AssessmentSection,
  type ModelChoice,
  type StageGroupV2,
} from "@/api/promptlab";

const MAX_CONCURRENT_REGENERATIONS = 10;
const SAVE_DEBOUNCE_MS = 2000;

/**
 * Assessment fixtures use a different shape than chat fixtures and don't
 * participate in the v2 page-state autosave loop. We keep their loaded
 * state in a parallel array.
 */
interface AssessmentLoadedSection {
  fixtureKey: string;
  sectionIndex: number;
  section: AssessmentSection;
}

function assessmentKey(s: AssessmentLoadedSection): string {
  return `${s.fixtureKey}::${s.section.name}`;
}

function stageGroupKey(sg: StageGroupV2, idx: number): string {
  if (sg.kind === "live_module") {
    return `live::${sg.moduleSlug}/${sg.sectionIndex}/${sg.segmentIndex}::${idx}`;
  }
  return `inline::${sg.name ?? "?"}::${idx}`;
}

export default function PromptLab() {
  const { isAuthenticated, isLoading, login } = useAuth();

  const [models, setModels] = useState<ModelChoice[]>([]);
  /** Default model seed for newly-added stage groups. Doesn't propagate to
   * existing groups when changed — each group's Inspector owns its own
   * model after creation. */
  const [defaultModel, setDefaultModel] = useState<string>("");
  /** Production tutor's base prompt — read-only display value used as the
   * placeholder in the global override sidebar. Loaded once at mount. */
  const [defaultBasePrompt, setDefaultBasePrompt] = useState<string>("");

  /**
   * The fixture file currently open. Single source of truth for chat
   * stage groups, global overrides, fixture name, and persistence target.
   * Mutating this triggers the auto-save effect.
   */
  const [currentFixture, setCurrentFixture] = useState<Fixture | null>(null);

  /** Assessment sections live separately — they use the legacy fixture
   * format and aren't auto-saved. */
  const [assessmentSections, setAssessmentSections] = useState<
    AssessmentLoadedSection[]
  >([]);
  const [loadedAssessmentNames, setLoadedAssessmentNames] = useState<string[]>(
    [],
  );

  const [savingState, setSavingState] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pickerState, setPickerState] = useState<
    "choose" | "fixture" | "live_module" | null
  >(null);

  const columnRefsMap = useRef<Map<string, ConversationColumnHandle>>(
    new Map(),
  );
  const assessmentRefsMap = useRef<Map<string, AssessmentColumnHandle>>(
    new Map(),
  );

  // --- Config bootstrap ---
  useEffect(() => {
    if (!isAuthenticated) return;
    getConfig()
      .then((cfg) => {
        setModels(cfg.models);
        setDefaultModel(cfg.defaultModel);
        setDefaultBasePrompt(cfg.defaultBasePrompt);
      })
      .catch((err) => console.error("Failed to load promptlab config:", err));
  }, [isAuthenticated]);

  // --- URL state: ?f=name reflects the open fixture ---
  // Mount-only: parse URL and load if present. Subsequent fixture changes
  // are written back to URL by the next effect.
  useEffect(() => {
    if (!isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const f = params.get("f");
    if (!f) return;
    apiLoadFixture(f)
      .then((fx) => {
        if (isAssessmentFixture(fx)) {
          setAssessmentSections(
            fx.sections.map((section, i) => ({
              fixtureKey: fx.name,
              sectionIndex: i,
              section,
            })),
          );
          setLoadedAssessmentNames([fx.name]);
          return;
        }
        setCurrentFixture(fx);
        setSavingState("saved");
      })
      .catch((err) =>
        console.error("Failed to load fixture from URL:", err),
      );
  }, [isAuthenticated]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const name = currentFixture?.name ?? loadedAssessmentNames[0];
    if (name) {
      params.set("f", name);
    } else {
      params.delete("f");
    }
    const qs = params.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [currentFixture?.name, loadedAssessmentNames]);

  // --- Auto-save: debounced PUT whenever currentFixture changes ---
  useEffect(() => {
    if (!currentFixture) return;
    if (savingState !== "dirty") return;
    const handle = setTimeout(async () => {
      setSavingState("saving");
      try {
        await saveFixture(currentFixture.name, currentFixture);
        setSavingState("saved");
        setSaveError(null);
      } catch (e) {
        setSavingState("error");
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [savingState, currentFixture]);

  /** Wrap a setter so any change marks the page dirty. Use this for any
   * user-initiated mutation that should persist. */
  const updateFixture = useCallback(
    (updater: (f: Fixture) => Fixture) => {
      setCurrentFixture((prev) => (prev ? updater(prev) : prev));
      setSavingState("dirty");
    },
    [],
  );

  // --- Add fixture (chat → become it; assessment → append) ---
  const handleAddFixture = useCallback(
    (fixture: Fixture | AssessmentFixture) => {
      if (isAssessmentFixture(fixture)) {
        setLoadedAssessmentNames((prev) =>
          prev.includes(fixture.name) ? prev : [...prev, fixture.name],
        );
        setAssessmentSections((prev) => {
          if (prev.some((s) => s.fixtureKey === fixture.name)) return prev;
          return [
            ...prev,
            ...fixture.sections.map((section, i) => ({
              fixtureKey: fixture.name,
              sectionIndex: i,
              section,
            })),
          ];
        });
        setPickerState(null);
        return;
      }
      // Chat fixture: become this fixture (single-fixture-per-page model).
      setCurrentFixture(fixture);
      setSavingState("saved");
      setPickerState(null);
    },
    [],
  );

  // --- Add live-module stage group ---
  const handleAddLiveModule = useCallback(
    (source: LiveModuleSource) => {
      const newSG: StageGroupV2 = {
        kind: "live_module",
        moduleSlug: source.moduleSlug,
        sectionIndex: source.sectionIndex,
        segmentIndex: source.segmentIndex,
        courseSlug: source.courseSlug ?? null,
        overrides: {},
        chats: [{ label: "Chat 1", messages: [] }],
      };

      if (currentFixture) {
        updateFixture((f) => ({ ...f, stageGroups: [...f.stageGroups, newSG] }));
        setPickerState(null);
        return;
      }

      // No fixture open — prompt for a name and create one.
      const default_ = `${source.moduleSlug}-${source.sectionIndex}-${source.segmentIndex}`
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const name = window.prompt(
        "Name this fixture (lowercase + dashes). Leave blank to skip persistence.",
        default_,
      );
      if (name) {
        setCurrentFixture({
          schemaVersion: 2,
          name,
          description: "",
          globalOverrides: { basePrompt: null },
          stageGroups: [newSG],
        });
        setSavingState("dirty");
      } else {
        // Cancel: still add to memory by creating an unsaved fixture stub.
        setCurrentFixture({
          schemaVersion: 2,
          name: "__unsaved__",
          description: "",
          globalOverrides: { basePrompt: null },
          stageGroups: [newSG],
        });
        // No dirty mark — this stub won't auto-save (the autosave effect
        // doesn't gate on name, so we leave savingState idle).
      }
      setPickerState(null);
    },
    [currentFixture, updateFixture],
  );

  // --- Remove stage group ---
  const handleRemoveStageGroup = useCallback(
    (idx: number) => {
      updateFixture((f) => ({
        ...f,
        stageGroups: f.stageGroups.filter((_, i) => i !== idx),
      }));
    },
    [updateFixture],
  );

  const handleRemoveAssessment = useCallback((key: string) => {
    setAssessmentSections((prev) => {
      const next = prev.filter((s) => assessmentKey(s) !== key);
      const remaining = new Set(next.map((s) => s.fixtureKey));
      setLoadedAssessmentNames((names) =>
        names.filter((n) => remaining.has(n)),
      );
      return next;
    });
  }, []);

  // --- Update one stage group (called by child StageGroup) ---
  const setStageGroupAt = useCallback(
    (idx: number) =>
      (updater: (sg: StageGroupV2) => StageGroupV2) => {
        updateFixture((f) => ({
          ...f,
          stageGroups: f.stageGroups.map((sg, i) =>
            i === idx ? updater(sg) : sg,
          ),
        }));
      },
    [updateFixture],
  );

  // --- Regenerate / score across columns ---
  const [regenSummary, setRegenSummary] = useState<string | null>(null);
  const regenSummaryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () => () => {
      if (regenSummaryTimeoutRef.current)
        clearTimeout(regenSummaryTimeoutRef.current);
    },
    [],
  );

  const stageGroupsCount = currentFixture?.stageGroups.length ?? 0;
  const hasChatStages = stageGroupsCount > 0;
  const hasAssessmentStages = assessmentSections.length > 0;

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
      if (active.length > 0) await Promise.race(active);
    }

    setRegenSummary(
      failed > 0
        ? `Regenerated ${succeeded}/${total} (${failed} failed)`
        : `Regenerated ${succeeded}/${total}`,
    );
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
      if (active.length > 0) await Promise.race(active);
    }
    setRegenSummary(
      failed > 0
        ? `Scored ${succeeded}/${total} (${failed} failed)`
        : `Scored ${succeeded}/${total}`,
    );
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
        title="Seed for newly-added stage groups."
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
            loadedFixtureNames={[
              ...(currentFixture ? [currentFixture.name] : []),
              ...loadedAssessmentNames,
            ]}
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

  // --- Empty state ---
  if (!currentFixture && assessmentSections.length === 0) {
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
  const fixtureName = currentFixture?.name ?? null;
  const globalBasePromptOverride =
    currentFixture?.globalOverrides?.basePrompt ?? null;

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 7rem)" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 py-2 shrink-0">
        <span className="text-sm font-semibold text-slate-800">Prompt Lab</span>
        <span className="text-sm text-slate-300">|</span>
        <button
          onClick={() => {
            setCurrentFixture(null);
            setAssessmentSections([]);
            setLoadedAssessmentNames([]);
            columnRefsMap.current.clear();
            assessmentRefsMap.current.clear();
            setSavingState("idle");
          }}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          Clear all
        </button>
        <span className="text-sm text-slate-300">|</span>
        {defaultModelDropdown}
        {fixtureName && fixtureName !== "__unsaved__" && (
          <>
            <span className="text-sm text-slate-300">|</span>
            <span className="text-xs text-slate-500 font-mono truncate max-w-[200px]">
              {fixtureName}
            </span>
            <SaveIndicator
              state={savingState}
              error={saveError}
              onForceSave={() => setSavingState("dirty")}
            />
          </>
        )}

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

      {/* Sidebar (global overrides) + horizontal scroll grid */}
      <div className="flex flex-1 min-h-0 gap-3">
        <GlobalOverridesSidebar
          defaultBasePrompt={defaultBasePrompt}
          basePromptOverride={globalBasePromptOverride}
          setBasePromptOverride={(v) => {
            updateFixture((f) => ({
              ...f,
              globalOverrides: { ...f.globalOverrides, basePrompt: v },
            }));
          }}
          // Display the sidebar even with no fixture — user can edit then
          // create a fixture; but disable in that case since no persistence.
          disabled={!currentFixture}
        />
        <div className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 h-full">
            {currentFixture?.stageGroups.map((sg, idx) => {
              const key = stageGroupKey(sg, idx);
              return (
                <StageGroup
                  key={key}
                  stageGroup={sg}
                  setStageGroup={setStageGroupAt(idx)}
                  stageKey={key}
                  model={defaultModel}
                  models={models}
                  globalBasePromptOverride={globalBasePromptOverride}
                  onRemove={() => handleRemoveStageGroup(idx)}
                  columnRefs={columnRefsMap}
                />
              );
            })}
            {assessmentSections.map((s) => {
              const key = assessmentKey(s);
              return (
                <AssessmentStageGroup
                  key={key}
                  section={s.section}
                  stageKey={key}
                  systemPrompt=""
                  model={defaultModel}
                  onRemove={() => handleRemoveAssessment(key)}
                  columnRefs={assessmentRefsMap}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({
  state,
  error,
  onForceSave,
}: {
  state: "idle" | "dirty" | "saving" | "saved" | "error";
  error: string | null;
  onForceSave: () => void;
}) {
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "dirty"
          ? "Save now"
          : state === "error"
            ? "Save failed"
            : "";
  const cls =
    state === "saving"
      ? "text-slate-500 bg-slate-100"
      : state === "saved"
        ? "text-emerald-700 bg-emerald-50"
        : state === "dirty"
          ? "text-blue-700 bg-blue-50 hover:bg-blue-100 cursor-pointer"
          : state === "error"
            ? "text-red-700 bg-red-50 hover:bg-red-100 cursor-pointer"
            : "text-slate-400";
  return (
    <button
      type="button"
      onClick={onForceSave}
      disabled={state === "saving" || state === "idle" || state === "saved"}
      title={error ?? undefined}
      className={`text-[11px] px-2 py-0.5 rounded ${cls}`}
    >
      {label}
    </button>
  );
}

function GlobalOverridesSidebar({
  defaultBasePrompt,
  basePromptOverride,
  setBasePromptOverride,
  disabled,
}: {
  defaultBasePrompt: string;
  basePromptOverride: string | null;
  setBasePromptOverride: (v: string | null) => void;
  disabled?: boolean;
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
          disabled={disabled}
          onClick={() =>
            setBasePromptOverride(isOverridden ? null : defaultBasePrompt)
          }
          className="ml-auto text-[10px] text-blue-600 hover:text-blue-800 disabled:text-slate-300"
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
