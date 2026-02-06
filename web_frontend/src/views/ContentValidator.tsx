import { useState, useEffect } from "react";
import { API_URL } from "../config";

interface ValidationIssue {
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
  severity: "error" | "warning";
}

interface DiffFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface ValidationState {
  status: string;
  known_sha?: string;
  known_sha_timestamp?: string;
  fetched_sha?: string;
  fetched_sha_timestamp?: string;
  processed_sha?: string;
  processed_sha_timestamp?: string;
  summary?: { errors: number; warnings: number };
  issues?: ValidationIssue[];
  diff?: DiffFile[];
}

type ConnectionStatus = "connecting" | "connected" | "reconnecting";

export default function ContentValidator() {
  const [state, setState] = useState<ValidationState | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/content/validation-stream`);

    source.addEventListener("validation", (event) => {
      const data: ValidationState = JSON.parse(event.data);
      setState(data);
      setConnectionStatus("connected");
    });

    source.onopen = () => setConnectionStatus("connected");
    source.onerror = () => setConnectionStatus("reconnecting");

    return () => source.close();
  }, []);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch(`${API_URL}/api/content/refresh-validation`, {
        method: "POST",
      });
    } catch {
      // SSE will push the update
    } finally {
      // Keep spinner briefly so it's visible
      setTimeout(() => setIsRefreshing(false), 1000);
    }
  };

  const issues = state?.issues || [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  return (
    <div className="py-8 max-w-4xl mx-auto px-4">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-bold">Content Validator</h1>
        <div className="flex items-center gap-3">
          <ConnectionIndicator status={connectionStatus} />
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            title='Incremental refresh. Should also trigger automatically if status is "Live"'
            className="text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50
                       text-gray-700 px-3 py-1.5 rounded-md"
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <p className="text-gray-600 mb-6">
        Live validation status. Updates automatically when content changes.{" "}
        <a
          href="https://github.com/Lens-Academy/lens-edu-relay/tree/staging"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          View repo on GitHub
        </a>
      </p>

      {/* Pipeline status */}
      {state && state.status !== "no_cache" && <PipelineStatus state={state} />}

      {state?.status === "no_cache" && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 mb-6">
          Cache not initialized. Click Refresh to load content.
        </div>
      )}

      {/* Diff section */}
      {state?.diff && state.diff.length > 0 && (
        <DiffSummary diff={state.diff} />
      )}

      {/* Results */}
      {state && state.status !== "no_cache" && (
        <div className="space-y-6">
          {/* Summary badges */}
          <div className="flex items-center gap-4">
            <div
              className={`px-4 py-2 rounded-lg font-medium ${
                (state.summary?.errors ?? errors.length) > 0
                  ? "bg-red-100 text-red-800"
                  : "bg-green-100 text-green-800"
              }`}
            >
              {state.summary?.errors ?? errors.length}{" "}
              {(state.summary?.errors ?? errors.length) === 1
                ? "error"
                : "errors"}
            </div>
            <div
              className={`px-4 py-2 rounded-lg font-medium ${
                (state.summary?.warnings ?? warnings.length) > 0
                  ? "bg-yellow-100 text-yellow-800"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {state.summary?.warnings ?? warnings.length}{" "}
              {(state.summary?.warnings ?? warnings.length) === 1
                ? "warning"
                : "warnings"}
            </div>
          </div>

          {/* Success message */}
          {(state.summary?.errors ?? 0) === 0 &&
            (state.summary?.warnings ?? 0) === 0 && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-800">
                All content is valid. No issues found.
              </div>
            )}

          {/* Errors */}
          {errors.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-red-700 mb-3">
                Errors
              </h2>
              <div className="space-y-3">
                {errors.map((issue, idx) => (
                  <IssueCard key={`error-${idx}`} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-yellow-700 mb-3">
                Warnings
              </h2>
              <div className="space-y-3">
                {warnings.map((issue, idx) => (
                  <IssueCard key={`warning-${idx}`} issue={issue} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const colors = {
    connecting: "bg-yellow-400",
    connected: "bg-green-400",
    reconnecting: "bg-yellow-400 animate-pulse",
  };
  const labels = {
    connecting: "Connecting...",
    connected: "Live",
    reconnecting: "Reconnecting...",
  };

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
      {labels[status]}
    </div>
  );
}

function PipelineStatus({ state }: { state: ValidationState }) {
  const isProcessing =
    state.known_sha &&
    state.processed_sha &&
    state.known_sha !== state.processed_sha;

  return (
    <div className="mb-6 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 space-y-1.5">
      {isProcessing && (
        <div className="flex items-center gap-2 text-blue-700 font-medium">
          <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>
            {state.fetched_sha === state.known_sha
              ? "Processing..."
              : "Fetching..."}
          </span>
        </div>
      )}
      <ShaRow
        label="Detected"
        sha={state.known_sha}
        timestamp={state.known_sha_timestamp}
      />
      <ShaRow
        label="Fetched"
        sha={state.fetched_sha}
        timestamp={state.fetched_sha_timestamp}
      />
      <ShaRow label="Processed" timestamp={state.processed_sha_timestamp} />
    </div>
  );
}

function ShaRow({
  label,
  sha,
  timestamp,
}: {
  label: string;
  sha?: string;
  timestamp?: string;
}) {
  if (!sha) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 text-gray-400">{label}</span>
      <code className="text-xs bg-gray-200 px-1 rounded">
        {sha.slice(0, 8)}
      </code>
      {timestamp && (
        <span className="text-gray-400">{formatRelativeTime(timestamp)}</span>
      )}
    </div>
  );
}

function DiffSummary({ diff }: { diff: DiffFile[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wide">
        Latest Changes
      </h2>
      <div className="space-y-1">
        {diff.map((file) => (
          <div key={file.filename}>
            <button
              onClick={() =>
                setExpanded(expanded === file.filename ? null : file.filename)
              }
              className="w-full text-left flex items-center gap-2 p-2 rounded
                         hover:bg-gray-50 text-sm font-mono"
            >
              <StatusBadge status={file.status} />
              <span className="flex-1 truncate">{file.filename}</span>
              <span className="text-green-600 text-xs">+{file.additions}</span>
              <span className="text-red-600 text-xs">-{file.deletions}</span>
              <span className="text-gray-400 text-xs">
                {expanded === file.filename ? "▼" : "▶"}
              </span>
            </button>
            {expanded === file.filename && file.patch && (
              <pre className="mx-2 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-x-auto">
                {file.patch.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "text-green-400"
                        : line.startsWith("-")
                          ? "text-red-400"
                          : line.startsWith("@@")
                            ? "text-blue-400"
                            : ""
                    }
                  >
                    {line}
                  </div>
                ))}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string }> = {
    added: { label: "A", color: "bg-green-100 text-green-700" },
    modified: { label: "M", color: "bg-blue-100 text-blue-700" },
    removed: { label: "D", color: "bg-red-100 text-red-700" },
    renamed: { label: "R", color: "bg-purple-100 text-purple-700" },
  };
  const c = config[status] || {
    label: "?",
    color: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold ${c.color}`}
    >
      {c.label}
    </span>
  );
}

function formatRelativeTime(isoString: string): string {
  // Server sends UTC timestamps (with +00:00 suffix). For any naive timestamps
  // (no timezone info), assume UTC to avoid local-time misinterpretation.
  const normalized = /[Z+-]\d{0,2}:?\d{0,2}$/.test(isoString)
    ? isoString
    : isoString + "Z";
  const date = new Date(normalized);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  const absTime = `${date.getHours()}h${date.getMinutes().toString().padStart(2, "0")}`;

  let relative: string;
  if (seconds < 10) relative = "Just now";
  else if (seconds < 60) relative = `${seconds}s ago`;
  else {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) relative = `${minutes}min ago`;
    else {
      const hours = Math.floor(minutes / 60);
      if (hours < 24) relative = `${hours}h ago`;
      else return date.toLocaleDateString() + ` (${absTime})`;
    }
  }

  return `${relative} (${absTime})`;
}

function IssueCard({ issue }: { issue: ValidationIssue }) {
  const isError = issue.severity === "error";
  const githubBase = "https://github.com/Lens-Academy/lens-edu-relay/blob";
  const fileUrl = `${githubBase}/staging/${issue.file}${issue.line ? `?plain=1#L${issue.line}` : ""}`;
  const isLinkable = issue.file.includes("/");

  return (
    <div
      className={`p-4 rounded-lg border ${
        isError ? "bg-red-50 border-red-200" : "bg-yellow-50 border-yellow-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-sm text-gray-600 mb-1">
            {issue.file}
            {issue.line != null && `:${issue.line}`}
            {isLinkable && (
              <>
                {" "}
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline font-sans text-xs"
                >
                  Show on GitHub
                </a>
              </>
            )}
          </div>
          <div
            className={`font-medium ${isError ? "text-red-800" : "text-yellow-800"}`}
          >
            {issue.message}
          </div>
          {issue.suggestion && (
            <div className="mt-1 text-sm text-gray-600">{issue.suggestion}</div>
          )}
        </div>
      </div>
    </div>
  );
}
