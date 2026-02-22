import { useState, useEffect } from "react";
import { listFixtures, loadFixture, type Fixture, type FixtureSummary } from "@/api/promptlab";

interface FixturePickerProps {
  loadedFixtureNames: string[];
  onSelect: (fixture: Fixture) => void;
  onClose: () => void;
}

export default function FixturePicker({
  loadedFixtureNames,
  onSelect,
  onClose,
}: FixturePickerProps) {
  const [fixtures, setFixtures] = useState<FixtureSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    listFixtures()
      .then(setFixtures)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, []);

  const available = fixtures.filter((f) => !loadedFixtureNames.includes(f.name));

  async function handleSelect(name: string) {
    setLoadingName(name);
    try {
      const fixture = await loadFixture(name);
      onSelect(fixture);
    } catch {
      // ignore
    } finally {
      setLoadingName(null);
    }
  }

  return (
    <div className="absolute top-full right-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="text-xs font-medium text-slate-700">Add fixture</span>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm">&times;</button>
      </div>
      {loading ? (
        <div className="p-3 text-xs text-slate-400">Loading...</div>
      ) : fetchError ? (
        <div className="p-3 text-xs text-red-500">Failed to load fixtures</div>
      ) : available.length === 0 ? (
        <div className="p-3 text-xs text-slate-400">All fixtures loaded</div>
      ) : (
        available.map((f) => (
          <button
            key={f.name}
            onClick={() => handleSelect(f.name)}
            disabled={loadingName === f.name}
            className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors border-b border-gray-50 last:border-b-0"
          >
            <div className="text-xs font-medium text-slate-800">{f.name}</div>
            <div className="text-[10px] text-slate-400">{f.module}</div>
          </button>
        ))
      )}
    </div>
  );
}
