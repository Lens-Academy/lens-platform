/**
 * Voice E2E Test - Exercises the full roleplay voice chain with detailed logging.
 *
 * NOT production UI. This page inlines the roleplay SSE + TTS WebSocket flow
 * with visibility into every step, so we can see exactly where things break.
 *
 * Includes a "Direct TTS" quick-test at the top to verify TTS in isolation.
 */

import { useState, useRef, useCallback } from "react";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { sendRoleplayMessage } from "@/api/roleplay";

// Hardcoded test config (same module used in manual testing)
const TEST_CONFIG = {
  moduleSlug: "lens/trial-question-and-roleplay",
  roleplayId: "313958db-3b65-438f-9725-d9b483977284",
  aiInstructions: `You are Jordan Chen, a 34-year-old product manager at a mid-size tech company. You're pragmatic, results-oriented, and genuinely busy. You care about doing the right thing but tend to prioritize shipping features over theoretical concerns. You're skeptical of anything that sounds too academic but can be persuaded by concrete examples. Keep responses conversational and brief (2-3 sentences typically). You're in a hurry — you have a meeting soon.`,
  openingMessage:
    "Good morning! I have about 5 minutes before my next meeting...",
};

type LogEntry = { time: string; tag: string; msg: string };

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

const TAG_COLORS: Record<string, string> = {
  SSE: "text-blue-400",
  TTS: "text-purple-400",
  AUDIO: "text-green-400",
  ERROR: "text-red-400",
  INFO: "text-gray-400",
};

export default function Page() {
  // --- Direct TTS quick-test state ---
  const [directText, setDirectText] = useState("Hello, this is a quick TTS test.");
  const [directStatus, setDirectStatus] = useState<string>("idle");

  // --- E2E test state ---
  const [userInput, setUserInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [sseStatus, setSseStatus] = useState("idle");
  const [ttsStatus, setTtsStatus] = useState("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chunkCount, setChunkCount] = useState(0);

  const audioPlayback = useAudioPlayback();
  const wsRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((tag: string, msg: string) => {
    setLogs((prev) => {
      const next = [...prev, { time: ts(), tag, msg }];
      // Keep last 200 entries
      return next.length > 200 ? next.slice(-200) : next;
    });
    // Auto-scroll
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // --- Direct TTS ---
  const handleDirectTTS = useCallback(async () => {
    if (!directText.trim()) return;
    setDirectStatus("connecting");
    audioPlayback.stop();
    setChunkCount(0);

    try {
      await audioPlayback.resume();
    } catch (err) {
      addLog("ERROR", `AudioContext resume failed: ${err}`);
      setDirectStatus("error");
      return;
    }

    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/tts`);

    ws.onopen = () => {
      setDirectStatus("streaming");
      addLog("TTS", "WebSocket connected (direct)");
      ws.send(JSON.stringify({ text: directText.trim(), voice: "Ashley", audio_encoding: "LINEAR16" }));
      addLog("TTS", `Sent text: "${directText.trim().slice(0, 80)}..."`);
    };

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        const bytes = await event.data.arrayBuffer();
        addLog("AUDIO", `Chunk: ${bytes.byteLength} bytes`);
        setChunkCount((c) => c + 1);
        try {
          await audioPlayback.playChunk(bytes);
        } catch (err) {
          addLog("ERROR", `playChunk failed: ${err}`);
        }
      } else {
        try {
          const msg = JSON.parse(event.data);
          if (msg.done) {
            addLog("TTS", "Done signal received");
            setDirectStatus("done");
          } else if (msg.error) {
            addLog("ERROR", `TTS error: ${msg.error}`);
            setDirectStatus("error");
          }
        } catch {
          addLog("TTS", `Text message: ${event.data}`);
        }
      }
    };

    ws.onerror = () => {
      addLog("ERROR", "WebSocket error (direct)");
      setDirectStatus("error");
    };

    ws.onclose = (e) => {
      addLog("TTS", `WebSocket closed (code=${e.code})`);
    };
  }, [directText, audioPlayback, addLog]);

  // --- E2E: Send & Speak (parallel SSE + TTS) ---
  const handleSendAndSpeak = useCallback(async () => {
    const msg = userInput.trim();
    if (!msg) return;

    // Reset
    setUserInput("");
    setStreamingContent("");
    setSseStatus("connecting");
    setTtsStatus("connecting");
    setChunkCount(0);
    audioPlayback.stop();

    // Resume AudioContext from user gesture
    try {
      await audioPlayback.resume();
      addLog("AUDIO", `AudioContext resumed (state: ${audioPlayback.contextState})`);
    } catch (err) {
      addLog("ERROR", `AudioContext resume failed: ${err}`);
      return;
    }

    // Add user message to conversation
    setMessages((prev) => [...prev, { role: "user", content: msg }]);
    addLog("INFO", `User message: "${msg.slice(0, 80)}"`);

    // Step 1: Open TTS WebSocket in streaming mode BEFORE SSE starts
    addLog("TTS", "Opening WebSocket in streaming mode");

    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProtocol}//${location.host}/ws/tts`);
    wsRef.current = ws;

    // Wait for WS to open before starting SSE
    const wsReady = new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        setTtsStatus("streaming");
        addLog("TTS", "WebSocket connected (streaming mode)");
        ws.send(JSON.stringify({ streaming: true, voice: "Ashley", audio_encoding: "LINEAR16" }));
        resolve();
      };
      ws.onerror = () => {
        addLog("ERROR", "TTS WebSocket failed to connect");
        setTtsStatus("error");
        reject(new Error("TTS WebSocket connection failed"));
      };
    });

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        const bytes = await event.data.arrayBuffer();
        addLog("AUDIO", `Chunk: ${bytes.byteLength} bytes`);
        setChunkCount((c) => c + 1);
        try {
          await audioPlayback.playChunk(bytes);
        } catch (err) {
          addLog("ERROR", `playChunk failed: ${err}`);
        }
      } else {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.done) {
            addLog("TTS", "TTS complete (done signal)");
            setTtsStatus("done");
          } else if (parsed.error) {
            addLog("ERROR", `TTS error: ${parsed.error}`);
            setTtsStatus("error");
          }
        } catch {
          addLog("TTS", `Text: ${event.data}`);
        }
      }
    };

    ws.onclose = (e) => {
      addLog("TTS", `WebSocket closed (code=${e.code})`);
      wsRef.current = null;
    };

    try {
      await wsReady;
    } catch {
      return; // WS failed, already logged
    }

    // Step 2: SSE to /api/chat/roleplay — forward tokens to TTS WS
    setSseStatus("streaming");
    addLog("SSE", "Starting SSE request to /api/chat/roleplay");

    let fullResponse = "";
    let eventCount = 0;
    let tokensSent = 0;

    try {
      const abortController = new AbortController();
      abortRef.current = abortController;

      for await (const event of sendRoleplayMessage({
        moduleSlug: TEST_CONFIG.moduleSlug,
        roleplayId: TEST_CONFIG.roleplayId,
        message: msg,
        aiInstructions: TEST_CONFIG.aiInstructions,
        openingMessage: TEST_CONFIG.openingMessage,
      })) {
        eventCount++;

        if (event.type === "text" && event.content) {
          fullResponse += event.content;
          setStreamingContent(fullResponse);

          // Forward token to TTS WebSocket
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ text: event.content }));
            tokensSent++;
          }

          // Log every 5th chunk to avoid spam
          if (eventCount % 5 === 0) {
            addLog("SSE", `text chunk #${eventCount} (total: ${fullResponse.length} chars, ${tokensSent} tokens→TTS)`);
          }
        } else if (event.type === "done") {
          addLog("SSE", `Done! ${fullResponse.length} chars in ${eventCount} events, ${tokensSent} tokens→TTS`);
          setSseStatus("done");
        } else if (event.type === "error") {
          addLog("ERROR", `SSE error: ${event.message}`);
          setSseStatus("error");
          // Flush TTS even on error so it can finish what it has
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ flush: true }));
          }
          return;
        } else {
          addLog("SSE", `Event: ${JSON.stringify(event).slice(0, 100)}`);
        }
      }
    } catch (err) {
      addLog("ERROR", `SSE request failed: ${err}`);
      setSseStatus("error");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ flush: true }));
      }
      return;
    }

    if (!fullResponse) {
      addLog("ERROR", "No response text received from SSE");
      setSseStatus("error");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ flush: true }));
      }
      return;
    }

    // Add assistant message
    setMessages((prev) => [...prev, { role: "assistant", content: fullResponse }]);
    setStreamingContent("");
    addLog("INFO", `LLM complete: ${fullResponse.length} chars`);

    // Signal TTS that all tokens have been sent
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ flush: true }));
      addLog("TTS", "Sent flush signal (LLM done)");
    }
  }, [userInput, audioPlayback, addLog]);

  const handleStop = useCallback(() => {
    audioPlayback.stop();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setSseStatus("idle");
    setTtsStatus("idle");
    setDirectStatus("idle");
    addLog("INFO", "Stopped all");
  }, [audioPlayback, addLog]);

  const statusColor = (s: string) => {
    if (s === "streaming" || s === "done") return "text-green-400";
    if (s === "connecting") return "text-yellow-400";
    if (s === "error") return "text-red-400";
    return "text-gray-500";
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Voice E2E Test</h1>
        <a href="/tts-test" className="text-sm text-blue-400 hover:text-blue-300">
          ← TTS Pipeline Test
        </a>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Full roleplay → TTS chain with detailed logging. Not production UI.
      </p>

      {/* Status bar */}
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded bg-gray-900 px-4 py-2 text-xs font-mono">
        <span>
          SSE: <span className={statusColor(sseStatus)}>{sseStatus}</span>
        </span>
        <span>
          TTS: <span className={statusColor(ttsStatus)}>{ttsStatus}</span>
        </span>
        <span>
          AudioContext:{" "}
          <span className="text-gray-300">{audioPlayback.contextState ?? "none"}</span>
        </span>
        <span>
          Chunks: <span className="text-gray-300">{chunkCount}</span>
        </span>
        <span>
          Playing:{" "}
          <span className={audioPlayback.isPlaying ? "text-green-400" : "text-gray-500"}>
            {audioPlayback.isPlaying ? "yes" : "no"}
          </span>
        </span>
        <button
          onClick={handleStop}
          className="ml-auto rounded bg-red-800 px-2 py-0.5 text-red-200 hover:bg-red-700"
        >
          Stop All
        </button>
      </div>

      {/* Direct TTS quick-test */}
      <div className="mb-6 rounded border border-gray-700 p-4">
        <h2 className="mb-2 text-sm font-medium text-gray-400">
          Direct TTS Quick Test{" "}
          <span className="font-normal text-gray-600">(bypasses SSE/roleplay)</span>
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={directText}
            onChange={(e) => setDirectText(e.target.value)}
            className="flex-1 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            placeholder="Quick TTS text..."
            onKeyDown={(e) => e.key === "Enter" && handleDirectTTS()}
          />
          <button
            onClick={handleDirectTTS}
            disabled={directStatus === "connecting" || directStatus === "streaming"}
            className="rounded bg-purple-600 px-4 py-1.5 text-sm text-white hover:bg-purple-700 disabled:cursor-default disabled:bg-gray-600"
          >
            Speak
          </button>
          <span className={`self-center text-xs ${statusColor(directStatus)}`}>
            {directStatus}
          </span>
        </div>
      </div>

      {/* Main E2E test area */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: Conversation */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-gray-400">Conversation</h2>
          <div className="mb-3 h-64 overflow-y-auto rounded border border-gray-700 bg-gray-900 p-3 text-sm">
            {messages.length === 0 && !streamingContent && (
              <span className="text-gray-600">Send a message to start the roleplay...</span>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`mb-2 ${m.role === "user" ? "text-blue-300" : "text-gray-200"}`}>
                <span className="text-xs font-medium text-gray-500">
                  {m.role === "user" ? "You" : "Jordan"}:{" "}
                </span>
                {m.content}
              </div>
            ))}
            {streamingContent && (
              <div className="mb-2 text-gray-200">
                <span className="text-xs font-medium text-gray-500">Jordan: </span>
                {streamingContent}
                <span className="animate-pulse text-gray-500">|</span>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              className="flex-1 rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
              placeholder="Type a message..."
              onKeyDown={(e) => e.key === "Enter" && handleSendAndSpeak()}
            />
            <button
              onClick={handleSendAndSpeak}
              disabled={sseStatus === "streaming" || sseStatus === "connecting" || !userInput.trim()}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-600"
            >
              Send &amp; Speak
            </button>
          </div>
        </div>

        {/* Right: Event log */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-400">Event Log</h2>
            <button
              onClick={() => setLogs([])}
              className="text-xs text-gray-600 hover:text-gray-400"
            >
              Clear
            </button>
          </div>
          <div className="h-80 overflow-y-auto rounded border border-gray-700 bg-gray-950 p-2 font-mono text-xs">
            {logs.length === 0 ? (
              <span className="text-gray-600">Events will appear here...</span>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="leading-5">
                  <span className="text-gray-600">{entry.time}</span>{" "}
                  <span className={TAG_COLORS[entry.tag] ?? "text-gray-400"}>
                    [{entry.tag}]
                  </span>{" "}
                  <span className="text-gray-300">{entry.msg}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* Test config info */}
      <div className="mt-6 rounded border border-gray-800 p-3 text-xs text-gray-600">
        <strong className="text-gray-500">Test config:</strong>{" "}
        module={TEST_CONFIG.moduleSlug}, roleplay={TEST_CONFIG.roleplayId.slice(0, 8)}...,
        character=Jordan Chen
      </div>
    </div>
  );
}
