import { useState, useEffect, useMemo } from "react";
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
  /** Seed value for the course dropdown (shared default across runs). */
  defaultCourseSlug?: string;
}

interface ModuleSummary {
  slug: string;
  title: string;
}

interface CourseSummary {
  slug: string;
  title: string;
  modules: ModuleSummary[];
}

interface SectionDetail {
  type: string;
  meta?: { title?: string | null };
  segments: { type: string; title?: string | null }[];
}

interface ModuleDetail {
  slug: string;
  title: string;
  sections: SectionDetail[];
}

/**
 * Cascading-dropdown picker: course → module → section → segment.
 *
 * Course is optional (defaults to "any") — without a course, the module
 * dropdown lists every available module. Selecting a course narrows it
 * to that course's progression. Section/segment dropdowns load lazily
 * after a module is picked. Sections show their meta.title and segments
 * show type + title so the facilitator can target a specific lens point
 * without translating slugs to indices by hand.
 */
export default function LiveModulePicker({
  onAdd,
  onCancel,
  defaultCourseSlug,
}: Props) {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [allModules, setAllModules] = useState<ModuleSummary[]>([]);
  const [courseSlug, setCourseSlug] = useState(defaultCourseSlug ?? "");
  const [moduleSlug, setModuleSlug] = useState("");
  const [moduleDetail, setModuleDetail] = useState<ModuleDetail | null>(null);
  const [moduleLoading, setModuleLoading] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);

  useEffect(() => {
    fetchWithRefresh(`${API_URL}/api/courses`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.courses) setCourses(data.courses);
      })
      .catch(() => {});
    fetchWithRefresh(`${API_URL}/api/modules?type=module`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.modules) setAllModules(data.modules);
      })
      .catch(() => {});
  }, []);

  // Modules narrowed to the selected course, or all modules if no course.
  const moduleOptions: ModuleSummary[] = useMemo(() => {
    if (!courseSlug) return allModules;
    const c = courses.find((c) => c.slug === courseSlug);
    return c?.modules ?? allModules;
  }, [courseSlug, courses, allModules]);

  // Auto-pick the first module when the module list changes and the current
  // pick isn't in it. Avoids showing a stale slug when switching courses.
  useEffect(() => {
    if (
      moduleOptions.length > 0 &&
      !moduleOptions.some((m) => m.slug === moduleSlug)
    ) {
      setModuleSlug(moduleOptions[0].slug);
    }
  }, [moduleOptions, moduleSlug]);

  // Load section/segment shape for the selected module.
  useEffect(() => {
    if (!moduleSlug) {
      setModuleDetail(null);
      return;
    }
    setModuleLoading(true);
    let cancelled = false;
    fetchWithRefresh(
      `${API_URL}/api/modules/${encodeURIComponent(moduleSlug)}`,
      { credentials: "include" },
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setModuleDetail(data);
        setSectionIndex(0);
        setSegmentIndex(0);
      })
      .catch(() => {
        if (!cancelled) setModuleDetail(null);
      })
      .finally(() => {
        if (!cancelled) setModuleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleSlug]);

  const sections = moduleDetail?.sections ?? [];
  const segments = sections[sectionIndex]?.segments ?? [];

  // Clamp segmentIndex if section change shrinks the segment list.
  useEffect(() => {
    if (segmentIndex >= segments.length && segments.length > 0) {
      setSegmentIndex(0);
    }
  }, [segmentIndex, segments.length]);

  const valid = moduleSlug.trim() !== "" && sections.length > 0;

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
      className="bg-white border border-slate-300 rounded-lg shadow-lg p-4 w-[440px] space-y-3"
    >
      <div className="text-sm font-semibold text-slate-700">
        Add live-module stage group
      </div>

      <Field label="Course">
        <select
          value={courseSlug}
          onChange={(e) => setCourseSlug(e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1 text-[12px]"
        >
          <option value="">(any — all modules)</option>
          {courses.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.title} ({c.slug})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Module">
        <select
          value={moduleSlug}
          onChange={(e) => setModuleSlug(e.target.value)}
          className="w-full border border-slate-200 rounded px-2 py-1 text-[12px]"
          disabled={moduleOptions.length === 0}
        >
          {moduleOptions.length === 0 && <option>(loading…)</option>}
          {moduleOptions.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.title || m.slug}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`Section${moduleLoading ? " (loading…)" : ""}`}>
        <select
          value={sectionIndex}
          onChange={(e) => setSectionIndex(Number(e.target.value))}
          className="w-full border border-slate-200 rounded px-2 py-1 text-[12px]"
          disabled={sections.length === 0}
        >
          {sections.map((s, i) => (
            <option key={i} value={i}>
              {i}: {s.meta?.title || `(${s.type})`}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Segment">
        <select
          value={segmentIndex}
          onChange={(e) => setSegmentIndex(Number(e.target.value))}
          className="w-full border border-slate-200 rounded px-2 py-1 text-[12px]"
          disabled={segments.length === 0}
        >
          {segments.map((g, i) => (
            <option key={i} value={i}>
              {i}: {g.type}
              {g.title ? ` — ${g.title}` : ""}
            </option>
          ))}
        </select>
      </Field>

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
