interface SystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  isModified: boolean;
}

export default function SystemPromptEditor({
  value,
  onChange,
  onReset,
  isModified,
}: SystemPromptEditorProps) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-slate-700">System Prompt</h2>
          {isModified && (
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" title="Modified" />
          )}
        </div>
        <button
          onClick={onReset}
          disabled={!isModified}
          className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
            isModified
              ? "text-slate-600 bg-slate-100 hover:bg-slate-200"
              : "text-slate-300 bg-slate-50 cursor-default"
          }`}
        >
          Reset
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full flex-1 resize-none p-3 text-xs text-slate-800 leading-relaxed border-none outline-none focus:ring-0 bg-white min-h-0"
        spellCheck={false}
      />
    </div>
  );
}
