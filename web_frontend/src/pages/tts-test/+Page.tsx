/**
 * TTS Pipeline Test - Test harness for verifying the full TTS pipeline.
 *
 * NOT production UI. Two sections:
 * 1. Direct TTS — send text over WebSocket, hear audio (single-shot or streaming playback)
 * 2. E2E Roleplay — send a chat message, stream LLM tokens into TTS WebSocket
 *
 * Used during development for end-to-end pipeline verification.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";

type Status = "idle" | "connecting" | "streaming" | "buffering" | "done" | "error";
type PlaybackMode = "streaming" | "buffered";

interface InworldVoice {
  voiceId: string;
  displayName: string;
  description?: string;
}

type LogEntry = { time: string; tag: string; msg: string };

const TTS_MODELS = [
  "inworld-tts-1.5-mini",
  "inworld-tts-1.5-max",
  "inworld-tts-1",
  "inworld-tts-1-max",
] as const;

const TAG_COLORS: Record<string, string> = {
  LLM: "text-blue-600",
  TTS: "text-purple-600",
  AUDIO: "text-green-600",
  ERROR: "text-red-600",
  INFO: "text-gray-500",
  "⏱": "text-yellow-600 font-bold",
};

const TEST_CONFIG = {
  moduleSlug: "lens/trial-question-and-roleplay",
  roleplayId: "313958db-3b65-438f-9725-d9b483977284",
  aiInstructions: `You're an assistant helping a developer test this a voice chatting feature. Speak in natural spoken language with relatively short sentences.`,
  openingMessage:
    "Good morning! I have about 5 minutes before my next meeting. I hear you'd like to talk about this voice feature.",
};

export default function Page() {
  // --- Shared state ---
  const [voice, setVoice] = useState("Ashley");
  const [model, setModel] = useState<string>(TTS_MODELS[0]);
  const [voices, setVoices] = useState<InworldVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logStartRef = useRef(0);

  // --- Direct TTS state ---
  const [text, setText] = useState(
    "Hello, I am an AI safety researcher. Let me tell you about alignment.",
  );
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<PlaybackMode>("buffered");
  const [speed, setSpeed] = useState(1.0);
  const [bufferedPlaying, setBufferedPlaying] = useState(false);
  const [simulateStreaming, setSimulateStreaming] = useState(false);
  const [tokenDelay, setTokenDelay] = useState(0.05);
  const wsRef = useRef<WebSocket | null>(null);
  const chunksBufferRef = useRef<Blob[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const audioPlayback = useAudioPlayback();

  // --- E2E Roleplay state (unified WebSocket) ---
  const [e2eOpen, setE2eOpen] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [e2eStatus, setE2eStatus] = useState("idle");
  const [e2eChunkCount, setE2eChunkCount] = useState(0);
  const e2eWsRef = useRef<WebSocket | null>(null);
  const e2eInitedRef = useRef(false); // Has init message been sent?
  const e2eAudioPlayback = useAudioPlayback();
  const [e2eVerbose, setE2eVerbose] = useState(false);
  const [e2eSpeed, setE2eSpeed] = useState(1.5);
  const e2eTimingRef = useRef({
    t0: 0, wsConnected: 0,
    firstText: 0, firstAudio: 0, audioStarted: 0,
    lastText: 0, lastAudio: 0,
  });
  const wasPlayingRef = useRef(false);
  const e2eStreamingRef = useRef(""); // Accumulate streaming content for ref access

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/tts/voices")
      .then((res) => res.json())
      .then((data: InworldVoice[]) => {
        setVoices(data);
        if (data.length > 0 && !data.some((v) => v.voiceId === "Ashley")) {
          setVoice(data[0].voiceId);
        }
      })
      .catch(() => setVoices([]))
      .finally(() => setVoicesLoading(false));
  }, []);

  const addLog = useCallback((tag: string, msg: string) => {
    const now = performance.now();
    if (!logStartRef.current) logStartRef.current = now;
    const elapsed = (now - logStartRef.current) / 1000;
    const time = elapsed.toFixed(3) + "s";
    setLogs((prev) => {
      const next = [...prev, { time, tag, msg }];
      return next.length > 200 ? next.slice(-200) : next;
    });
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const ms = useCallback(() => `+${(performance.now() - e2eTimingRef.current.t0).toFixed(0)}ms`, []);

  // Track e2e audio playback finished
  useEffect(() => {
    if (wasPlayingRef.current && !e2eAudioPlayback.isPlaying && e2eTimingRef.current.t0 > 0) {
      const t = e2eTimingRef.current;
      const now = performance.now();
      addLog("⏱", `Audio playback finished (+${(now - t.t0).toFixed(0)}ms total)`);
    }
    wasPlayingRef.current = e2eAudioPlayback.isPlaying;
  }, [e2eAudioPlayback.isPlaying, addLog]);

  // ─── Direct TTS ───────────────────────────────────────────────────────

  const handleSpeak = useCallback(async () => {
    if (!text.trim()) {
      addLog("ERROR", "No text to synthesize");
      return;
    }

    setLogs([]);
    logStartRef.current = 0;
    setStatus("connecting");
    audioPlayback.stop();
    chunksBufferRef.current = [];

    try {
      await audioPlayback.resume();
      addLog("AUDIO", "AudioContext resumed (user gesture)");
    } catch (err) {
      addLog("ERROR", `Failed to resume AudioContext: ${err}`);
      setStatus("error");
      return;
    }

    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${location.host}/ws/tts`;
    addLog("TTS", `Connecting to ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog("TTS", "WebSocket connected");
      setStatus("streaming");

      const payload = JSON.stringify({
        text: text.trim(),
        voice,
        model,
        audio_encoding: currentMode === "streaming" ? "LINEAR16" : "MP3",
        ...(currentMode === "streaming" && currentSpeed !== 1.0
          ? { speaking_rate: currentSpeed }
          : {}),
        ...(simulateStreaming ? { simulate_streaming: true, token_delay: tokenDelay } : {}),
      });
      if (simulateStreaming) {
        addLog("TTS", `Simulate LLM streaming: ON (delay=${tokenDelay}s/token, ~${text.trim().split(/\s+/).length} tokens)`);
      }
      addLog("TTS", `Sending: ${payload.slice(0, 120)}${payload.length > 120 ? "..." : ""}`);
      ws.send(payload);
    };

    const currentMode = mode;
    const currentSpeed = speed;

    if (currentMode === "streaming") {
      audioPlayback.setPlaybackRate(1.0);
    }

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        if (currentMode === "streaming") {
          const bytes = await event.data.arrayBuffer();
          addLog("AUDIO", `Chunk: ${bytes.byteLength} bytes`);
          try {
            await audioPlayback.playChunk(bytes);
          } catch (err) {
            addLog("ERROR", `playChunk failed: ${err}`);
          }
        } else {
          addLog("AUDIO", `Chunk: ${event.data.size} bytes`);
          chunksBufferRef.current.push(event.data);
        }
      } else {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.done) {
            addLog("TTS", "Server: synthesis complete (done=true)");

            if (currentMode === "buffered" && chunksBufferRef.current.length > 0) {
              const chunks = chunksBufferRef.current;
              const totalLen = chunks.reduce((sum, c) => sum + c.size, 0);
              const blob = new Blob(chunks, { type: "audio/mpeg" });
              addLog("AUDIO", `Playing buffered audio: ${totalLen} bytes in ${chunks.length} chunks (blob: ${blob.size} bytes)`);

              if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
              const url = URL.createObjectURL(blob);
              blobUrlRef.current = url;
              const audio = new Audio(url);
              audioElRef.current = audio;
              audio.playbackRate = currentSpeed;
              audio.onloadedmetadata = () => {
                addLog("AUDIO", `Duration: ${audio.duration.toFixed(3)}s (speed: ${audio.playbackRate}x)`);
              };
              audio.onended = () => {
                addLog("AUDIO", "Buffered playback finished");
                audioElRef.current = null;
                URL.revokeObjectURL(url);
                blobUrlRef.current = null;
                setBufferedPlaying(false);
                setStatus("idle");
              };
              audio.onerror = () => {
                addLog("ERROR", "<audio> playback failed");
                setBufferedPlaying(false);
                setStatus("error");
              };
              setBufferedPlaying(true);
              try {
                await audio.play();
              } catch (err) {
                addLog("ERROR", `Buffered play failed: ${err}`);
                setBufferedPlaying(false);
                setStatus("error");
              }
              chunksBufferRef.current = [];
            } else {
              setStatus("done");
            }
          } else if (msg.error) {
            addLog("ERROR", `Server: ${msg.error}`);
            setStatus("error");
          } else {
            addLog("TTS", `Server message: ${JSON.stringify(msg)}`);
          }
        } catch {
          addLog("TTS", `Server text: ${event.data}`);
        }
      }
    };

    ws.onerror = () => {
      addLog("ERROR", "WebSocket error");
      setStatus("error");
    };

    ws.onclose = (event: CloseEvent) => {
      addLog("TTS", `WebSocket closed (code=${event.code}, reason=${event.reason || "none"})`);
      wsRef.current = null;
    };
  }, [text, voice, model, mode, speed, simulateStreaming, tokenDelay, audioPlayback, addLog]);

  const handleStop = useCallback(() => {
    addLog("INFO", "Stopping playback");
    audioPlayback.stop();
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
      setBufferedPlaying(false);
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("idle");
  }, [audioPlayback, addLog]);

  // ─── E2E Roleplay ────────────────────────────────────────────────────

  /** Open the unified roleplay WebSocket (first send only). */
  const ensureE2eWs = useCallback((): Promise<WebSocket> => {
    const existing = e2eWsRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProtocol}//${location.host}/ws/chat/roleplay`;
      addLog("INFO", `Opening unified WS: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      e2eWsRef.current = ws;
      e2eInitedRef.current = false;

      ws.onopen = () => {
        e2eTimingRef.current.wsConnected = performance.now();
        addLog("INFO", "WebSocket connected");

        // Send init message with TTS config
        const anonymousToken = crypto.randomUUID();
        ws.send(JSON.stringify({
          module_slug: TEST_CONFIG.moduleSlug,
          roleplay_id: TEST_CONFIG.roleplayId,
          ai_instructions: TEST_CONFIG.aiInstructions,
          opening_message: TEST_CONFIG.openingMessage,
          anonymous_token: anonymousToken,
          voice,
          model,
          audio_encoding: "LINEAR16",
          speaking_rate: e2eSpeed,
        }));
        addLog("INFO", `Init message sent (voice=${voice}, speed=${e2eSpeed}x)`);
      };

      // Set up the shared onmessage handler
      const verbose = e2eVerbose;
      ws.onmessage = async (event: MessageEvent) => {
        if (event.data instanceof Blob) {
          // Binary = TTS audio chunk
          const timing = e2eTimingRef.current;
          if (!timing.firstAudio) {
            timing.firstAudio = performance.now();
            addLog("⏱", `${ms()} First audio chunk`);
          }
          const bytes = await event.data.arrayBuffer();
          if (verbose) addLog("AUDIO", `Chunk: ${bytes.byteLength} bytes`);
          setE2eChunkCount((c) => c + 1);
          try {
            await e2eAudioPlayback.playChunk(bytes);
            if (!timing.audioStarted) {
              timing.audioStarted = performance.now();
              addLog("⏱", `${ms()} Audio playback started`);
            }
          } catch (err) {
            addLog("ERROR", `playChunk failed: ${err}`);
          }
        } else {
          // JSON message
          try {
            const parsed = JSON.parse(event.data as string);
            const timing = e2eTimingRef.current;

            switch (parsed.type) {
              case "session":
                e2eInitedRef.current = true;
                addLog("INFO", `Session ${parsed.session_id} (${parsed.messages?.length ?? 0} messages)`);
                // Load existing messages if resuming
                if (parsed.messages?.length > 0) {
                  setMessages(parsed.messages);
                }
                resolve(ws);
                break;

              case "text":
                if (!timing.firstText) {
                  timing.firstText = performance.now();
                  addLog("⏱", `${ms()} First text token`);
                }
                timing.lastText = performance.now();
                e2eStreamingRef.current += parsed.content;
                setStreamingContent(e2eStreamingRef.current);
                if (verbose) addLog("LLM", `"${parsed.content}"`);
                break;

              case "thinking":
                if (verbose) addLog("LLM", `[thinking] ${parsed.content?.slice(0, 80)}`);
                break;

              case "log":
                addLog(parsed.tag ?? "INFO", parsed.msg);
                break;

              case "done": {
                timing.lastAudio = performance.now();
                addLog("⏱", `${ms()} Turn done`);
                if (parsed.audio_bytes) {
                  addLog("⏱", `  Server sent: ${parsed.audio_chunks} chunks, ${parsed.audio_bytes} bytes`);
                }
                // Latency breakdown
                const d = (a: number, b: number) => a && b ? `${(a - b).toFixed(0)}ms` : "n/a";
                const msgStart = timing.wsConnected || timing.t0;
                addLog("⏱", "── Latency Breakdown ──");
                if (timing.wsConnected) {
                  addLog("⏱", `  WS connect:        ${d(timing.wsConnected, timing.t0)}  (frontend → backend)`);
                }
                addLog("⏱", `  LLM first token:   ${d(timing.firstText, msgStart)}  (message → first token)`);
                addLog("⏱", `  LLM generation:    ${d(timing.lastText, timing.firstText)}  (first → last token)`);
                addLog("⏱", `  First audio chunk:  ${d(timing.firstAudio, timing.firstText)}  (first text → first audio)`);
                addLog("⏱", `  Audio decode:      ${d(timing.audioStarted, timing.firstAudio)}  (first chunk → playback start)`);
                addLog("⏱", `  Streaming total:   ${d(timing.lastAudio, timing.t0)}  (send → all streams done)`);
                const fullContent = e2eStreamingRef.current;
                if (fullContent) {
                  setMessages((prev) => [...prev, { role: "assistant", content: fullContent }]);
                  addLog("INFO", `Response: ${fullContent.length} chars`);
                }
                setStreamingContent("");
                e2eStreamingRef.current = "";
                setE2eStatus("idle");
                e2eAudioPlayback.endStream();
                break;
              }

              case "error":
                addLog("ERROR", parsed.message);
                setE2eStatus("error");
                break;

              default:
                addLog("INFO", `Unknown: ${JSON.stringify(parsed).slice(0, 100)}`);
            }
          } catch {
            addLog("INFO", `Raw text: ${event.data}`);
          }
        }
      };

      ws.onerror = () => {
        addLog("ERROR", "WebSocket error");
        setE2eStatus("error");
        reject(new Error("WebSocket connection failed"));
      };

      ws.onclose = (e) => {
        addLog("INFO", `WebSocket closed (code=${e.code})`);
        e2eWsRef.current = null;
        e2eInitedRef.current = false;
      };
    });
  }, [voice, model, e2eSpeed, e2eAudioPlayback, e2eVerbose, addLog, ms]);

  const handleSendAndSpeak = useCallback(async () => {
    const msg = userInput.trim();
    if (!msg) return;

    setUserInput("");
    setStreamingContent("");
    e2eStreamingRef.current = "";
    setE2eStatus("streaming");
    setE2eChunkCount(0);
    e2eAudioPlayback.stop();

    try {
      await e2eAudioPlayback.resume();
      e2eAudioPlayback.beginStream();
      addLog("AUDIO", `AudioContext resumed (state: ${e2eAudioPlayback.contextState})`);
    } catch (err) {
      addLog("ERROR", `AudioContext resume failed: ${err}`);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: msg }]);

    logStartRef.current = 0;
    e2eTimingRef.current = {
      t0: performance.now(), wsConnected: 0,
      firstText: 0, firstAudio: 0, audioStarted: 0,
      lastText: 0, lastAudio: 0,
    };
    addLog("⏱", "User message sent");

    try {
      const ws = await ensureE2eWs();
      // Send user message
      ws.send(JSON.stringify({ message: msg }));
      addLog("LLM", `Sent: "${msg.slice(0, 80)}"`);
    } catch (err) {
      addLog("ERROR", `Failed: ${err}`);
      setE2eStatus("error");
    }
  }, [userInput, e2eAudioPlayback, addLog, ensureE2eWs]);

  const handleE2eStop = useCallback(() => {
    e2eAudioPlayback.stop();
    if (e2eWsRef.current) {
      // Send cancel if turn is in progress
      if (e2eWsRef.current.readyState === WebSocket.OPEN) {
        e2eWsRef.current.send(JSON.stringify({ cancel: true }));
      }
      e2eWsRef.current.close();
      e2eWsRef.current = null;
      e2eInitedRef.current = false;
    }
    setE2eStatus("idle");
    addLog("INFO", "Stopped E2E");
  }, [e2eAudioPlayback, addLog]);

  // ─── Helpers ──────────────────────────────────────────────────────────

  const statusColor: Record<Status, string> = {
    idle: "text-gray-500",
    connecting: "text-yellow-600",
    streaming: "text-green-600",
    buffering: "text-yellow-600",
    done: "text-blue-600",
    error: "text-red-600",
  };

  const e2eStatusColor = (s: string) => {
    if (s === "streaming" || s === "done") return "text-green-600";
    if (s === "connecting") return "text-yellow-600";
    if (s === "error") return "text-red-600";
    return "text-gray-500";
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">TTS Pipeline Test</h1>

      {/* Status indicators */}
      <div className="mb-4 flex gap-6 text-sm">
        <div>
          <span className="text-gray-500">Status: </span>
          <span className={statusColor[status]}>{status}</span>
        </div>
        <div>
          <span className="text-gray-500">AudioContext: </span>
          <span className="text-gray-700">
            {audioPlayback.contextState ?? "none"}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Playing: </span>
          <span className={audioPlayback.isPlaying || bufferedPlaying ? "text-green-600" : "text-gray-400"}>
            {audioPlayback.isPlaying || bufferedPlaying ? "yes" : "no"}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Chunks: </span>
          <span className="text-gray-700">{audioPlayback.chunksReceived}</span>
        </div>
      </div>

      {/* Text input */}
      <div className="mb-4">
        <label htmlFor="tts-text" className="mb-1 block text-sm text-gray-400">
          Text to synthesize
        </label>
        <textarea
          id="tts-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full rounded border border-gray-300 bg-white p-3 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
          placeholder="Enter text to speak..."
        />
      </div>

      {/* Model & Voice selectors */}
      <div className="mb-4 flex gap-4">
        <div>
          <label htmlFor="tts-model" className="mb-1 block text-sm text-gray-400">
            Model
          </label>
          <select
            id="tts-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none"
          >
            {TTS_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="tts-voice" className="mb-1 block text-sm text-gray-400">
            Voice {voicesLoading && "(loading...)"}
          </label>
          <select
            id="tts-voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={voicesLoading}
            className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-50"
          >
            {voices.length === 0 && !voicesLoading && (
              <option value="Ashley">Ashley (fallback)</option>
            )}
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId} title={v.description}>
                {v.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Speed control */}
      <div className="mb-4 flex items-center gap-3">
        <label htmlFor="tts-speed" className="text-sm text-gray-400">
          Speed: {speed.toFixed(1)}x
          {mode === "streaming" && <span className="text-gray-600"> (server-side)</span>}
        </label>
        <input
          id="tts-speed"
          type="range"
          min={mode === "streaming" ? 0.5 : 0.7}
          max={mode === "streaming" ? 1.5 : 2.0}
          step={0.1}
          value={speed}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            setSpeed(val);
            if (mode === "buffered") {
              audioPlayback.setPlaybackRate(val);
              if (audioElRef.current) audioElRef.current.playbackRate = val;
            }
          }}
          className="w-48 accent-blue-500"
        />
        <span className="text-xs text-gray-500">
          {mode === "streaming" ? "0.5x – 1.5x" : "0.7x – 2.0x"}
        </span>
      </div>

      {/* Playback mode toggle */}
      <div className="mb-4 flex items-center gap-4">
        <span className="text-sm text-gray-400">Playback:</span>
        {(["streaming", "buffered"] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="playback-mode"
              value={m}
              checked={mode === m}
              onChange={() => {
                setMode(m);
                if (m === "streaming" && speed > 1.5) setSpeed(1.5);
                if (m === "buffered" && speed < 0.7) setSpeed(0.7);
              }}
              className="accent-blue-500"
            />
            <span className={mode === m ? "text-gray-900 font-medium" : "text-gray-500"}>
              {m === "streaming" ? "Streaming (play as chunks arrive)" : "Buffered (play after all received)"}
            </span>
          </label>
        ))}
      </div>

      {/* Simulate LLM streaming toggle */}
      <div className="mb-4 flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={simulateStreaming}
            onChange={(e) => setSimulateStreaming(e.target.checked)}
            className="accent-blue-500"
          />
          <span className="text-gray-700">Simulate LLM token streaming</span>
        </label>
        {simulateStreaming && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-gray-500">Delay:</span>
            <input
              type="number"
              min={0}
              max={0.5}
              step={0.01}
              value={tokenDelay}
              onChange={(e) => setTokenDelay(parseFloat(e.target.value) || 0.05)}
              className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500">s/token</span>
          </label>
        )}
      </div>

      {/* Controls */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={handleSpeak}
          disabled={status === "connecting" || status === "streaming" || audioPlayback.isPlaying || bufferedPlaying}
          className="rounded bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-300"
        >
          Speak
        </button>
        <button
          onClick={handleStop}
          disabled={status === "idle"}
          className="rounded bg-red-600 px-6 py-2 text-white transition-colors hover:bg-red-700 disabled:cursor-default disabled:bg-gray-300"
        >
          Stop
        </button>
      </div>

      {/* ─── E2E Roleplay Test (collapsible) ──────────────────────────── */}
      <div className="mb-6 rounded border border-gray-200">
        <button
          onClick={() => setE2eOpen(!e2eOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>E2E Roleplay Test <span className="font-normal text-gray-600">(unified WebSocket: LLM + TTS)</span></span>
          <span className="text-gray-500">{e2eOpen ? "▾" : "▸"}</span>
        </button>

        {e2eOpen && (
          <div className="border-t border-gray-200 p-4">
            {/* E2E status bar */}
            <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded bg-gray-50 px-4 py-2 text-xs font-mono">
              <span>
                Status: <span className={e2eStatusColor(e2eStatus)}>{e2eStatus}</span>
              </span>
              <span>
                Session: <span className={e2eWsRef.current ? "text-green-600" : "text-gray-500"}>{e2eWsRef.current ? "connected" : "closed"}</span>
              </span>
              <span>
                AudioContext:{" "}
                <span className="text-gray-700">{e2eAudioPlayback.contextState ?? "none"}</span>
              </span>
              <span>
                Chunks: <span className="text-gray-700">{e2eChunkCount}</span>
              </span>
              <span>
                Playing:{" "}
                <span className={e2eAudioPlayback.isPlaying ? "text-green-600" : "text-gray-500"}>
                  {e2eAudioPlayback.isPlaying ? "yes" : "no"}
                </span>
              </span>
              <button
                onClick={handleE2eStop}
                className="ml-auto rounded bg-red-100 px-2 py-0.5 text-red-700 hover:bg-red-200"
              >
                Stop
              </button>
            </div>

            {/* Speed + verbose */}
            <div className="mb-3 flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                Speed: {e2eSpeed.toFixed(1)}x
                <input
                  type="range"
                  min={1.0}
                  max={1.5}
                  step={0.1}
                  value={e2eSpeed}
                  onChange={(e) => setE2eSpeed(parseFloat(e.target.value))}
                  className="w-24 accent-blue-500"
                />
              </label>
            </div>
            <label className="mb-3 flex items-center gap-1.5 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={e2eVerbose}
                onChange={(e) => setE2eVerbose(e.target.checked)}
                className="accent-yellow-500"
              />
              Verbose logging (every LLM token + audio chunk)
            </label>

            {/* Conversation */}
            <div className="mb-3 h-48 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-3 text-sm">
              {messages.length === 0 && !streamingContent && (
                <span className="text-gray-600">Send a message to start the roleplay...</span>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`mb-2 ${m.role === "user" ? "text-blue-600" : "text-gray-800"}`}>
                  <span className="text-xs font-medium text-gray-500">
                    {m.role === "user" ? "You" : "Jordan"}:{" "}
                  </span>
                  {m.content}
                </div>
              ))}
              {streamingContent && (
                <div className="mb-2 text-gray-800">
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
                className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none"
                placeholder="Type a message..."
                onKeyDown={(e) => e.key === "Enter" && handleSendAndSpeak()}
              />
              <button
                onClick={handleSendAndSpeak}
                disabled={e2eStatus === "streaming" || !userInput.trim()}
                className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-300"
              >
                Send &amp; Speak
              </button>
            </div>

            {/* Test config info */}
            <div className="mt-3 text-xs text-gray-600">
              <strong className="text-gray-500">Test config:</strong>{" "}
              module={TEST_CONFIG.moduleSlug}, roleplay={TEST_CONFIG.roleplayId.slice(0, 8)}...,
              character=Jordan Chen, voice={voice}, model={model}
            </div>
          </div>
        )}
      </div>

      {/* Log panel */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-400">Event Log</h2>
          <button
            onClick={() => { setLogs([]); logStartRef.current = 0; }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear
          </button>
        </div>
        <div className="h-64 overflow-y-auto rounded bg-gray-50 p-3 font-mono text-xs">
          {logs.length === 0 ? (
            <span className="text-gray-600">
              Click &quot;Speak&quot; to start...
            </span>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="leading-5">
                <span className="text-gray-400">{entry.time}</span>{" "}
                <span className={TAG_COLORS[entry.tag] ?? "text-gray-400"}>
                  [{entry.tag}]
                </span>{" "}
                <span className="text-gray-700">{entry.msg}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
    </div>
  );
}
