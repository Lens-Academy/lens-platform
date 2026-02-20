import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import FixtureBrowser from "@/components/promptlab/FixtureBrowser";
import SystemPromptEditor from "@/components/promptlab/SystemPromptEditor";
import StageGroup from "@/components/promptlab/StageGroup";
import FixturePicker from "@/components/promptlab/FixturePicker";
import type { ConversationColumnHandle } from "@/components/promptlab/ConversationColumn";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/assemblePrompt";
import type { Fixture } from "@/api/promptlab";

const MAX_CONCURRENT_REGENERATIONS = 10;

export default function PromptLab() {
  const { isAuthenticated, isLoading, login } = useAuth();

  // Shared state
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [enableThinking, setEnableThinking] = useState(true);
  const [effort, setEffort] = useState<"low" | "medium" | "high">("low");

  // Multi-fixture state
  const [stages, setStages] = useState<Fixture[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  // Refs to all conversation columns for "Regenerate All"
  const columnRefsMap = useRef<Map<string, ConversationColumnHandle>>(new Map());

  const handleAddFixture = useCallback((fixture: Fixture) => {
    setStages((prev) => {
      if (prev.some((s) => s.name === fixture.name)) return prev;
      return [...prev, fixture];
    });
    setShowPicker(false);
  }, []);

  const handleRemoveStage = useCallback((name: string) => {
    setStages((prev) => prev.filter((s) => s.name !== name));
  }, []);

  const handleBack = useCallback(() => {
    setStages([]);
    setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
    setShowPicker(false);
  }, []);

  // Regenerate All summary state
  const [regenSummary, setRegenSummary] = useState<string | null>(null);

  const handleRegenerateAll = useCallback(async () => {
    const columns = Array.from(columnRefsMap.current.values());
    if (columns.length === 0) return;

    setRegenSummary(null);

    // Auto-select last assistant message in each column
    for (const col of columns) {
      col.autoSelectLastAssistant();
    }

    // Small delay so selection state updates
    await new Promise((r) => setTimeout(r, 50));

    // Fire regenerations with concurrency cap, track results
    let succeeded = 0;
    let failed = 0;
    const total = columns.length;
    const queue = [...columns];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
      while (active.length < MAX_CONCURRENT_REGENERATIONS && queue.length > 0) {
        const col = queue.shift()!;
        const p = col.regenerate()
          .then(() => { succeeded++; })
          .catch(() => { failed++; })
          .finally(() => { active.splice(active.indexOf(p), 1); });
        active.push(p);
      }
      if (active.length > 0) {
        await Promise.race(active);
      }
    }

    // Show summary
    if (failed > 0) {
      setRegenSummary(`Regenerated ${succeeded}/${total} (${failed} failed)`);
    } else {
      setRegenSummary(`Regenerated ${succeeded}/${total}`);
    }
    // Auto-dismiss after 5 seconds
    setTimeout(() => setRegenSummary(null), 5000);
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

  // --- Fixture browser (no stages loaded) ---

  if (stages.length === 0) {
    return (
      <div className="py-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-900">Prompt Lab</h1>
          <p className="text-sm text-slate-500 mt-1">
            Test system prompt variations against saved conversation fixtures.
          </p>
        </div>
        <FixtureBrowser onSelectFixture={handleAddFixture} />
      </div>
    );
  }

  // --- Multi-conversation grid ---

  const isPromptModified = systemPrompt !== DEFAULT_SYSTEM_PROMPT;

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 7rem)" }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 py-2 shrink-0">
        <button
          onClick={handleBack}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          &larr; Back
        </button>
        <span className="text-sm text-slate-300">|</span>

        {/* LLM config */}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={enableThinking}
            onChange={(e) => setEnableThinking(e.target.checked)}
            className="rounded border-slate-300"
          />
          Reasoning
        </label>
        {enableThinking && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Effort
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as "low" | "medium" | "high")}
              className="border border-slate-300 rounded px-1.5 py-0.5 text-xs bg-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2 relative">
          {regenSummary && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">
              {regenSummary}
            </span>
          )}
          <button
            onClick={handleRegenerateAll}
            className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
          >
            Regenerate All
          </button>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1.5 rounded hover:bg-slate-200 transition-colors"
          >
            + Add
          </button>
          {showPicker && (
            <FixturePicker
              loadedFixtureNames={stages.map((s) => s.name)}
              onSelect={handleAddFixture}
              onClose={() => setShowPicker(false)}
            />
          )}
        </div>
      </div>

      {/* System prompt editor */}
      <div className="shrink-0 mb-3">
        <SystemPromptEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          onReset={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
          isModified={isPromptModified}
        />
      </div>

      {/* Horizontal scroll grid of stage groups */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 h-full">
          {stages.map((fixture) => (
            <StageGroup
              key={fixture.name}
              fixture={fixture}
              systemPrompt={systemPrompt}
              enableThinking={enableThinking}
              effort={effort}
              onRemove={() => handleRemoveStage(fixture.name)}
              columnRefs={columnRefsMap}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
