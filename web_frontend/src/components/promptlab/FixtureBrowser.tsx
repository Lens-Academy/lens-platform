import { useState, useEffect, useMemo } from "react";
import {
  listFixtures,
  loadFixture,
  type Fixture,
  type FixtureSummary,
} from "@/api/promptlab";

interface FixtureBrowserProps {
  onSelectFixture: (fixture: Fixture) => void;
}

/**
 * FixtureBrowser -- lists available conversation fixtures with module filtering.
 *
 * Fetches the fixture list on mount, displays each as a clickable card,
 * and supports filtering by module name via a dropdown.
 */
export default function FixtureBrowser({
  onSelectFixture,
}: FixtureBrowserProps) {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedModule, setSelectedModule] = useState<string>("all");
  const [loadingFixture, setLoadingFixture] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchFixtures() {
      setLoading(true);
      setError(null);
      try {
        const data = await listFixtures();
        if (!cancelled) {
          setFixtures(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load fixtures",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchFixtures();
    return () => {
      cancelled = true;
    };
  }, []);

  const modules = useMemo(() => {
    const unique = new Set(fixtures.map((f) => f.module));
    return Array.from(unique).sort();
  }, [fixtures]);

  const filteredFixtures = useMemo(() => {
    if (selectedModule === "all") return fixtures;
    return fixtures.filter((f) => f.module === selectedModule);
  }, [fixtures, selectedModule]);

  async function handleSelect(fixture: FixtureSummary) {
    setLoadingFixture(fixture.name);
    try {
      const full = await loadFixture(fixture.name);
      onSelectFixture(full);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load fixture",
      );
    } finally {
      setLoadingFixture(null);
    }
  }

  // --- Loading state ---
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="animate-pulse bg-white border border-stone-200 rounded-lg p-4"
          >
            <div className="h-5 w-48 bg-stone-200 rounded mb-2" />
            <div className="h-4 w-32 bg-stone-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // --- Error state ---
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-sm text-red-700 mb-3">{error}</p>
        <button
          onClick={() => {
            setError(null);
            setLoading(true);
            listFixtures()
              .then(setFixtures)
              .catch((err) =>
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to load fixtures",
                ),
              )
              .finally(() => setLoading(false));
          }}
          className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // --- Empty state ---
  if (fixtures.length === 0) {
    return (
      <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
        <p className="text-slate-600 mb-2">No fixtures available.</p>
        <p className="text-sm text-slate-400">
          Add JSON files to{" "}
          <code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">
            core/promptlab/fixtures/
          </code>{" "}
          to get started.
        </p>
      </div>
    );
  }

  // --- Fixture list ---
  return (
    <div>
      {/* Module filter */}
      {modules.length > 1 && (
        <div className="mb-3">
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="text-sm border border-stone-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400/50"
          >
            <option value="all">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Fixture cards */}
      <div className="space-y-2">
        {filteredFixtures.map((fixture) => {
          const isLoading = loadingFixture === fixture.name;
          return (
            <button
              key={fixture.name}
              onClick={() => handleSelect(fixture)}
              disabled={isLoading}
              className={`w-full text-left bg-white border border-stone-200 rounded-lg p-4 transition-colors ${
                isLoading
                  ? "opacity-60"
                  : "hover:border-slate-400 hover:bg-stone-50 cursor-pointer"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-slate-900 truncate">
                    {fixture.name}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {fixture.module}
                  </p>
                  {fixture.description && (
                    <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                      {fixture.description}
                    </p>
                  )}
                </div>
                {isLoading && (
                  <div className="shrink-0 w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
