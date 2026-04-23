/**
 * Dev-mode request inspector store.
 *
 * The in-course tutor chat streams a `request_assembled` event as its first
 * SSE event (when the backend is not in production). This store collects
 * those payloads into a ring buffer so the floating Inspector can display
 * the last N turns.
 *
 * Singleton in-module state + pub/sub. No React context because the dev
 * Inspector needs to be wired from any hook in the chat flow (useTutorChat)
 * without prop-drilling through module-specific components.
 */

export interface InspectorEntry {
  id: string;
  timestamp: number;
  /** Module + position that produced this request, for identification. */
  moduleId: string;
  sectionIndex: number;
  segmentIndex: number;
  /** The last user message sent, for quick scanning. */
  lastUserMessage: string | null;
  payload: {
    system_prompt: string;
    llm_messages: { role: string; content: string }[];
    llm_kwargs: Record<string, unknown>;
  };
}

const MAX_ENTRIES = 25;

let entries: InspectorEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function addEntry(entry: Omit<InspectorEntry, "id" | "timestamp">) {
  const full: InspectorEntry = {
    ...entry,
    id: `inspect-${nextId++}`,
    timestamp: Date.now(),
  };
  entries = [full, ...entries].slice(0, MAX_ENTRIES);
  notify();
}

export function clearEntries() {
  entries = [];
  notify();
}

export function getEntries(): InspectorEntry[] {
  return entries;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
