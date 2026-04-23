import { useState, useRef, useEffect, useCallback } from "react";
import ChatMarkdown from "@/components/ChatMarkdown";
import { runTutorTurn, type StreamEvent } from "@/api/promptlab";

interface Message {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  toolEvents?: ToolEvent[];
}

interface ToolEvent {
  name: string;
  state: "calling" | "result" | "error";
  arguments?: Record<string, unknown>;
  result?: string;
}

interface LiveTutorViewProps {
  defaultBasePrompt: string;
  model: string;
  enableThinking: boolean;
  effort: string;
}

/**
 * Live Tutor mode — runs the production tutor pipeline end-to-end
 * (system prompt, course overview, segment context, tools, multi-round
 * tool execution) against a real module, with no DB writes. Every piece
 * of the pipeline has a toggle so a facilitator can isolate behavior.
 */
export default function LiveTutorView({
  defaultBasePrompt,
  model,
  enableThinking,
  effort,
}: LiveTutorViewProps) {
  const [moduleSlug, setModuleSlug] = useState("");
  const [courseSlug, setCourseSlug] = useState("default");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);

  const [basePromptOverride, setBasePromptOverride] = useState(defaultBasePrompt);
  const [enableTools, setEnableTools] = useState(true);
  const [enableCourseOverview, setEnableCourseOverview] = useState(true);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingToolEvents, setStreamingToolEvents] = useState<ToolEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  // Keep base-prompt editor in sync if the default changes (initial config load).
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current && defaultBasePrompt) {
      setBasePromptOverride(defaultBasePrompt);
      initializedRef.current = true;
    }
  }, [defaultBasePrompt]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText, streamingThinking, streamingToolEvents]);

  const resetPrompt = useCallback(() => {
    setBasePromptOverride(defaultBasePrompt);
  }, [defaultBasePrompt]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming || !moduleSlug.trim()) return;

    const userMsg: Message = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    setStreamingThinking("");
    setStreamingToolEvents([]);
    setError(null);
    abortRef.current = false;

    let accText = "";
    let accThinking = "";
    let accTools: ToolEvent[] = [];

    try {
      const stream = runTutorTurn({
        moduleSlug: moduleSlug.trim(),
        sectionIndex,
        segmentIndex,
        courseSlug: courseSlug.trim() || null,
        messages: nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        basePromptOverride:
          basePromptOverride === defaultBasePrompt ? null : basePromptOverride,
        enableTools,
        enableCourseOverview,
        enableThinking,
        effort,
        model,
      });

      for await (const event of stream as AsyncGenerator<StreamEvent>) {
        if (abortRef.current) break;
        if (event.type === "text" && event.content) {
          accText += event.content;
          setStreamingText(accText);
        } else if (event.type === "thinking" && event.content) {
          accThinking += event.content;
          setStreamingThinking(accThinking);
        } else if (event.type === "tool_use") {
          const toolEvent: ToolEvent = {
            name: event.name ?? "tool",
            state: event.state ?? "calling",
            arguments: event.arguments,
            result: event.result,
          };
          accTools = [...accTools, toolEvent];
          setStreamingToolEvents(accTools);
        } else if (event.type === "error") {
          setError(event.message ?? "Unknown error");
        } else if (event.type === "done") {
          if (accText) {
            const assistantMsg: Message = {
              role: "assistant",
              content: accText,
              thinking: accThinking || undefined,
              toolEvents: accTools.length ? accTools : undefined,
            };
            setMessages((prev) => [...prev, assistantMsg]);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run tutor turn");
    } finally {
      setIsStreaming(false);
      setStreamingText("");
      setStreamingThinking("");
      setStreamingToolEvents([]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    abortRef.current = true;
    setMessages([]);
    setError(null);
  }

  const basePromptModified = basePromptOverride !== defaultBasePrompt;

  return (
    <div className="flex gap-3 h-full">
      {/* Left: settings + base prompt editor */}
      <div className="shrink-0 w-[380px] flex flex-col gap-3 overflow-y-auto">
        {/* Scenario inputs */}
        <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-700 mb-1">
            Scenario
          </div>
          <label className="block">
            <span className="text-[10px] font-medium text-slate-500">
              Module slug
            </span>
            <input
              type="text"
              value={moduleSlug}
              onChange={(e) => setModuleSlug(e.target.value)}
              placeholder="e.g. most-important-century"
              className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-medium text-slate-500">
              Course slug (for overview)
            </span>
            <input
              type="text"
              value={courseSlug}
              onChange={(e) => setCourseSlug(e.target.value)}
              placeholder="default"
              className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className="text-[10px] font-medium text-slate-500">
                Section
              </span>
              <input
                type="number"
                min={0}
                value={sectionIndex}
                onChange={(e) => setSectionIndex(Number(e.target.value))}
                className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
            <label className="block flex-1">
              <span className="text-[10px] font-medium text-slate-500">
                Segment
              </span>
              <input
                type="number"
                min={0}
                value={segmentIndex}
                onChange={(e) => setSegmentIndex(Number(e.target.value))}
                className="w-full border border-slate-200 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </label>
          </div>
        </div>

        {/* Pipeline toggles */}
        <div className="border border-slate-200 rounded-lg bg-white p-3 space-y-1">
          <div className="text-xs font-semibold text-slate-700 mb-1">
            Pipeline toggles
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <input
              type="checkbox"
              checked={enableTools}
              onChange={(e) => setEnableTools(e.target.checked)}
              className="rounded border-slate-300"
            />
            Tools (alignment search + course content)
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <input
              type="checkbox"
              checked={enableCourseOverview}
              onChange={(e) => setEnableCourseOverview(e.target.checked)}
              className="rounded border-slate-300"
            />
            Course overview
          </label>
          <div className="text-[10px] text-slate-400 pt-1">
            Reasoning & effort are controlled in the toolbar above (shared with
            fixtures).
          </div>
        </div>

        {/* Base prompt editor */}
        <div className="border border-slate-200 rounded-lg bg-white p-3 flex flex-col gap-1 flex-1 min-h-0">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">
              Tutor base prompt
              {basePromptModified && (
                <span className="ml-1.5 text-[10px] font-normal text-amber-600">
                  (modified)
                </span>
              )}
            </div>
            {basePromptModified && (
              <button
                onClick={resetPrompt}
                className="text-[10px] text-slate-500 hover:text-slate-700"
              >
                Reset to default
              </button>
            )}
          </div>
          <textarea
            value={basePromptOverride}
            onChange={(e) => setBasePromptOverride(e.target.value)}
            className="flex-1 min-h-[12rem] border border-slate-200 rounded p-2 text-[11px] text-slate-700 font-mono resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
            spellCheck={false}
          />
        </div>
      </div>

      {/* Right: chat */}
      <div className="flex-1 flex flex-col border border-slate-200 rounded-lg bg-white min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50/50">
          <span className="text-xs font-semibold text-slate-700">
            Live Tutor
          </span>
          {moduleSlug && (
            <span className="text-[10px] text-slate-500">
              {moduleSlug} / section {sectionIndex} / segment {segmentIndex}
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              disabled={isStreaming}
              className="ml-auto text-[10px] text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <div className="px-3 py-1.5 bg-red-50 text-[11px] text-red-700 flex items-center gap-2">
            <span className="truncate flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 shrink-0"
            >
              &times;
            </button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && !isStreaming && (
            <div className="text-[11px] text-slate-400 text-center mt-8">
              Enter a module slug on the left, then send a message to run the
              real tutor pipeline.
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {isStreaming && (
            <StreamingBubble
              thinking={streamingThinking}
              text={streamingText}
              toolEvents={streamingToolEvents}
            />
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2 p-3 border-t border-slate-100"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              moduleSlug
                ? "Message the tutor..."
                : "Set a module slug first..."
            }
            disabled={isStreaming || !moduleSlug.trim()}
            rows={2}
            className="flex-1 border border-slate-200 rounded px-2 py-1 text-[12px] resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim() || !moduleSlug.trim()}
            className="bg-blue-600 text-white text-xs px-3 py-1 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default self-stretch"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  if (message.role === "user") {
    return (
      <div className="bg-slate-100 text-slate-800 p-2 rounded ml-8">
        <div className="text-[10px] text-slate-400 mb-0.5">Student</div>
        <div className="text-[12px] whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {message.thinking && (
        <div>
          <button
            onClick={() => setThinkingOpen(!thinkingOpen)}
            className="text-[10px] text-amber-600 hover:text-amber-700"
          >
            {thinkingOpen ? "▼" : "▶"} Reasoning
          </button>
          {thinkingOpen && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 mt-1 font-mono text-[10px] text-amber-900 whitespace-pre-wrap">
              {message.thinking}
            </div>
          )}
        </div>
      )}
      {message.toolEvents && message.toolEvents.length > 0 && (
        <div>
          <button
            onClick={() => setToolsOpen(!toolsOpen)}
            className="text-[10px] text-emerald-700 hover:text-emerald-800"
          >
            {toolsOpen ? "▼" : "▶"} Tool calls ({message.toolEvents.length})
          </button>
          {toolsOpen && (
            <div className="space-y-1 mt-1">
              {message.toolEvents.map((te, i) => (
                <ToolEventBlock key={i} event={te} />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="bg-blue-50 text-slate-800 p-2 rounded">
        <div className="text-[10px] text-slate-400 mb-0.5">Tutor</div>
        <div className="text-[12px] prose-compact">
          <ChatMarkdown>{message.content}</ChatMarkdown>
        </div>
      </div>
    </div>
  );
}

function StreamingBubble({
  thinking,
  text,
  toolEvents,
}: {
  thinking: string;
  text: string;
  toolEvents: ToolEvent[];
}) {
  return (
    <div className="space-y-1">
      {thinking && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2">
          <div className="text-[10px] text-amber-600 mb-0.5">Thinking...</div>
          <div className="font-mono text-[10px] text-amber-900 whitespace-pre-wrap">
            {thinking}
          </div>
        </div>
      )}
      {toolEvents.map((te, i) => (
        <ToolEventBlock key={i} event={te} />
      ))}
      <div className="bg-blue-50 text-slate-800 p-2 rounded">
        <div className="text-[10px] text-slate-400 mb-0.5">Tutor</div>
        {text ? (
          <div className="text-[12px] prose-compact">
            <ChatMarkdown>{text}</ChatMarkdown>
          </div>
        ) : (
          <div className="text-[11px] text-slate-400">Generating...</div>
        )}
      </div>
    </div>
  );
}

function ToolEventBlock({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const color =
    event.state === "error"
      ? "text-red-700 bg-red-50 border-red-200"
      : event.state === "result"
        ? "text-emerald-800 bg-emerald-50 border-emerald-200"
        : "text-slate-700 bg-slate-50 border-slate-200";
  return (
    <div className={`border rounded p-1.5 text-[10px] ${color}`}>
      <button
        onClick={() => setOpen(!open)}
        className="font-mono w-full text-left"
      >
        {open ? "▼" : "▶"} {event.name} · {event.state}
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {event.arguments && (
            <pre className="font-mono text-[10px] whitespace-pre-wrap">
              args: {JSON.stringify(event.arguments, null, 2)}
            </pre>
          )}
          {event.result && (
            <pre className="font-mono text-[10px] whitespace-pre-wrap">
              {event.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
