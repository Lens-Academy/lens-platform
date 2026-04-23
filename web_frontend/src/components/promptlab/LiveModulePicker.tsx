import { useState, useEffect } from "react";
import { API_URL } from "@/config";
import { fetchWithRefresh } from "@/api/fetchWithRefresh";

export interface LiveModuleSource {
  moduleSlug: string;
  sectionIndex: number;
  segmentIndex: number;
  courseSlug?: string;
}

interface Props {
  onAdd: (source: LiveModuleSource) => void;
  onCancel: () => void;
  /** Seed value for the course-slug input (shared default across runs). */
  defaultCourseSlug?: string;
}

interface ModuleSummary {
  slug: string;
  title: string;
}

/**
 * Inline form to pick a live module + position for a new stage group.
 *
 * Renders as a popover-style card. Kept minimal — autocomplete from the
 * content cache would be nice but can come later; for now the facilitator
 * types slugs by hand (same as the old Live Tutor tab).
 */
export default function LiveModulePicker({
  onAdd,
  onCancel,
  defaultCourseSlug,
}: Props) {
  const [moduleSlug, setModuleSlug] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [courseSlug, setCourseSlug] = useState(defaultCourseSlug ?? "");
  const [modules, setModules] = useState<ModuleSummary[]>([]);

  useEffect(() => {
    fetchWithRefresh(`${API_URL}/api/modules?type=module`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.modules) {
          setModules(
            data.modules.map((m: ModuleSummary) => ({
              slug: m.slug,
              title: m.title,
            })),
          );
        }
      })
      .catch(() => {
        // Autocomplete is a nice-to-have; silent fail is OK.
      });
  }, []);

  const valid = moduleSlug.trim() !== "";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onAdd({
      moduleSlug: moduleSlug.trim(),
      sectionIndex,
      segmentIndex,
      courseSlug: courseSlug.trim() || undefined,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-300 rounded-lg shadow-lg p-4 w-[400px] space-y-3"
    >
      <div className="text-sm font-semibold text-slate-700">
        Add live-module stage group
      </div>
      <div className="text-[11px] text-slate-500 -mt-1">
        Loads a live module, section, and segment. Synthesizes a ScenarioTurn
        via the same `build_scenario_turn` path the production tutor uses.
      </div>

      <label className="block">
        <span className="text-[11px] font-medium text-slate-600">
          Module slug{" "}
          {modules.length > 0 && (
            <span className="text-slate-400">({modules.length} available)</span>
          )}
        </span>
        <input
          type="text"
          list="live-module-slugs"
          value={moduleSlug}
          onChange={(e) => setModuleSlug(e.target.value)}
          placeholder="e.g. module-fundamental-difficulties"
          className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
        <datalist id="live-module-slugs">
          {modules.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.title}
            </option>
          ))}
        </datalist>
      </label>

      <div className="flex gap-2">
        <label className="flex-1 block">
          <span className="text-[11px] font-medium text-slate-600">
            Section index
          </span>
          <input
            type="number"
            min={0}
            value={sectionIndex}
            onChange={(e) => setSectionIndex(Number(e.target.value))}
            className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label className="flex-1 block">
          <span className="text-[11px] font-medium text-slate-600">
            Segment index
          </span>
          <input
            type="number"
            min={0}
            value={segmentIndex}
            onChange={(e) => setSegmentIndex(Number(e.target.value))}
            className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[11px] font-medium text-slate-600">
          Course slug <span className="text-slate-400">(optional)</span>
        </span>
        <input
          type="text"
          value={courseSlug}
          onChange={(e) => setCourseSlug(e.target.value)}
          placeholder="e.g. superintelligence-101"
          className="w-full mt-0.5 border border-slate-200 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-[11px] text-slate-600 hover:text-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid}
          className="px-3 py-1 text-[11px] font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </form>
  );
}
