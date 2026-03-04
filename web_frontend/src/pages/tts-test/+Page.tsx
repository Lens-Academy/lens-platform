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
import { Mic, Loader2, Square } from "lucide-react";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { useUnifiedRoleplay } from "@/hooks/useUnifiedRoleplay";
import type { RoleplayWsMessage } from "@/types/roleplay-ws";

type Status =
  | "idle"
  | "connecting"
  | "streaming"
  | "buffering"
  | "done"
  | "error";
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
  STT: "text-orange-600",
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

  // --- Shared logging ---
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((tag: string, msg: string) => {
    const now = performance.now();
    if (!logStartRef.current) logStartRef.current = now;
    const elapsed = (now - logStartRef.current) / 1000;
    const time = elapsed.toFixed(3) + "s";
    setLogs((prev) => {
      const next = [...prev, { time, tag, msg }];
      return next.length > 200 ? next.slice(-200) : next;
    });
    setTimeout(
      () => logEndRef.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  }, []);

  // --- E2E Roleplay state (unified WebSocket via hook) ---
  const [e2eOpen, setE2eOpen] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [e2eVerbose, setE2eVerbose] = useState(false);
  const [e2eSpeed, setE2eSpeed] = useState(1.5);
  const e2eTimingRef = useRef({
    t0: 0,
    wsConnected: 0,
    firstText: 0,
    firstAudio: 0,
    audioStarted: 0,
    lastText: 0,
    lastAudio: 0,
  });
  const wasPlayingRef = useRef(false);
  const e2eVerboseRef = useRef(false);
  e2eVerboseRef.current = e2eVerbose;

  const handleE2eMessage = useCallback(
    (msg: RoleplayWsMessage) => {
      const timing = e2eTimingRef.current;
      const elapsed = () => `+${(performance.now() - timing.t0).toFixed(0)}ms`;
      const verbose = e2eVerboseRef.current;

      switch (msg.type) {
        case "session":
          addLog(
            "INFO",
            `Session ${msg.session_id} (${msg.messages?.length ?? 0} messages)`,
          );
          break;
        case "text":
          if (!timing.firstText) {
            timing.firstText = performance.now();
            addLog("⏱", `${elapsed()} First text token`);
          }
          timing.lastText = performance.now();
          if (verbose) addLog("LLM", `"${msg.content}"`);
          break;
        case "thinking":
          if (verbose) addLog("LLM", `[thinking] ${msg.content?.slice(0, 80)}`);
          break;
        case "log":
          addLog(msg.tag ?? "INFO", msg.msg);
          break;
        case "audio":
          if (!timing.firstAudio) {
            timing.firstAudio = performance.now();
            addLog("⏱", `${elapsed()} First audio chunk`);
          }
          if (verbose) addLog("AUDIO", `Chunk: ${msg.bytes} bytes`);
          break;
        case "done": {
          timing.lastAudio = performance.now();
          addLog("⏱", `${elapsed()} Turn done`);
          if (msg.audio_bytes) {
            addLog(
              "⏱",
              `  Server sent: ${msg.audio_chunks} chunks, ${msg.audio_bytes} bytes`,
            );
          }
          const d = (a: number, b: number) =>
            a && b ? `${(a - b).toFixed(0)}ms` : "n/a";
          const msgStart = timing.wsConnected || timing.t0;
          addLog("⏱", "── Latency Breakdown ──");
          if (timing.wsConnected) {
            addLog(
              "⏱",
              `  WS connect:        ${d(timing.wsConnected, timing.t0)}  (frontend → backend)`,
            );
          }
          addLog(
            "⏱",
            `  LLM first token:   ${d(timing.firstText, msgStart)}  (message → first token)`,
          );
          addLog(
            "⏱",
            `  LLM generation:    ${d(timing.lastText, timing.firstText)}  (first → last token)`,
          );
          addLog(
            "⏱",
            `  First audio chunk:  ${d(timing.firstAudio, timing.firstText)}  (first text → first audio)`,
          );
          addLog(
            "⏱",
            `  Audio decode:      ${d(timing.audioStarted, timing.firstAudio)}  (first chunk → playback start)`,
          );
          addLog(
            "⏱",
            `  Streaming total:   ${d(timing.lastAudio, timing.t0)}  (send → all streams done)`,
          );
          break;
        }
        case "error":
          addLog("ERROR", msg.message);
          break;
      }
    },
    [addLog],
  );

  const e2e = useUnifiedRoleplay({
    ...TEST_CONFIG,
    voice,
    model,
    speakingRate: e2eSpeed,
    onMessage: handleE2eMessage,
  });

  // --- Direct TTS voice recording (mic → textarea) ---
  const directStt = useVoiceRecording({
    onTranscription: (transcribed) => {
      addLog("STT", `Transcription: "${transcribed}"`);
      setText(transcribed);
    },
    onError: (msg) => addLog("STT", `Error: ${msg}`),
  });

  // --- E2E voice recording (mic → auto-send) ---
  const e2eStt = useVoiceRecording({
    onTranscription: (transcribed) => {
      addLog("STT", `Transcription: "${transcribed}"`);
      handleSendAndSpeak(transcribed);
    },
    onError: (msg) => addLog("STT", `Error: ${msg}`),
  });

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

  // Track e2e audio playback finished
  useEffect(() => {
    if (
      wasPlayingRef.current &&
      !e2e.isPlaying &&
      e2eTimingRef.current.t0 > 0
    ) {
      const t = e2eTimingRef.current;
      const now = performance.now();
      addLog(
        "⏱",
        `Audio playback finished (+${(now - t.t0).toFixed(0)}ms total)`,
      );
    }
    wasPlayingRef.current = e2e.isPlaying;
  }, [e2e.isPlaying, addLog]);

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
        ...(simulateStreaming
          ? { simulate_streaming: true, token_delay: tokenDelay }
          : {}),
      });
      if (simulateStreaming) {
        addLog(
          "TTS",
          `Simulate LLM streaming: ON (delay=${tokenDelay}s/token, ~${text.trim().split(/\s+/).length} tokens)`,
        );
      }
      addLog(
        "TTS",
        `Sending: ${payload.slice(0, 120)}${payload.length > 120 ? "..." : ""}`,
      );
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

            if (
              currentMode === "buffered" &&
              chunksBufferRef.current.length > 0
            ) {
              const chunks = chunksBufferRef.current;
              const totalLen = chunks.reduce((sum, c) => sum + c.size, 0);
              const blob = new Blob(chunks, { type: "audio/mpeg" });
              addLog(
                "AUDIO",
                `Playing buffered audio: ${totalLen} bytes in ${chunks.length} chunks (blob: ${blob.size} bytes)`,
              );

              if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
              const url = URL.createObjectURL(blob);
              blobUrlRef.current = url;
              const audio = new Audio(url);
              audioElRef.current = audio;
              audio.playbackRate = currentSpeed;
              audio.onloadedmetadata = () => {
                addLog(
                  "AUDIO",
                  `Duration: ${audio.duration.toFixed(3)}s (speed: ${audio.playbackRate}x)`,
                );
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
      addLog(
        "TTS",
        `WebSocket closed (code=${event.code}, reason=${event.reason || "none"})`,
      );
      wsRef.current = null;
    };
  }, [
    text,
    voice,
    model,
    mode,
    speed,
    simulateStreaming,
    tokenDelay,
    audioPlayback,
    addLog,
  ]);

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

  const handleSendAndSpeak = useCallback(
    async (messageOverride?: string) => {
      const msg = (messageOverride ?? userInput).trim();
      if (!msg) return;

      if (!messageOverride) setUserInput("");

      // Reset timing for this turn
      logStartRef.current = 0;
      e2eTimingRef.current = {
        t0: performance.now(),
        wsConnected: 0,
        firstText: 0,
        firstAudio: 0,
        audioStarted: 0,
        lastText: 0,
        lastAudio: 0,
      };
      addLog("⏱", "User message sent");
      addLog("LLM", `Sent: "${msg.slice(0, 80)}"`);

      await e2e.sendMessage(msg);
    },
    [userInput, e2e, addLog],
  );

  const handleE2eStop = useCallback(() => {
    e2e.cancel();
    addLog("INFO", "Stopped E2E");
  }, [e2e, addLog]);

  // ─── STT click handlers (log before delegating) ─────────────────────

  const handleDirectMicClick = useCallback(() => {
    if (directStt.recordingState === "idle") {
      addLog("STT", "Recording started...");
    }
    directStt.handleMicClick();
  }, [directStt, addLog]);

  const handleE2eMicClick = useCallback(() => {
    if (e2eStt.recordingState === "idle") {
      addLog("STT", "Recording started...");
    }
    e2eStt.handleMicClick();
  }, [e2eStt, addLog]);

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
            <span
              className={
                audioPlayback.isPlaying || bufferedPlaying
                  ? "text-green-600"
                  : "text-gray-400"
              }
            >
              {audioPlayback.isPlaying || bufferedPlaying ? "yes" : "no"}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Chunks: </span>
            <span className="text-gray-700">
              {audioPlayback.chunksReceived}
            </span>
          </div>
        </div>

        {/* Text input */}
        <div className="mb-4">
          <label
            htmlFor="tts-text"
            className="mb-1 block text-sm text-gray-400"
          >
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
            <label
              htmlFor="tts-model"
              className="mb-1 block text-sm text-gray-400"
            >
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
            <label
              htmlFor="tts-voice"
              className="mb-1 block text-sm text-gray-400"
            >
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
            {mode === "streaming" && (
              <span className="text-gray-600"> (server-side)</span>
            )}
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
              <span
                className={
                  mode === m ? "text-gray-900 font-medium" : "text-gray-500"
                }
              >
                {m === "streaming"
                  ? "Streaming (play as chunks arrive)"
                  : "Buffered (play after all received)"}
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
                onChange={(e) =>
                  setTokenDelay(parseFloat(e.target.value) || 0.05)
                }
                className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 focus:border-blue-500 focus:outline-none"
              />
              <span className="text-gray-500">s/token</span>
            </label>
          )}
        </div>

        {/* Recording indicator (Direct TTS) */}
        {directStt.recordingState === "recording" && (
          <div className="mb-2 flex items-center gap-3 text-sm text-orange-600">
            <div className="flex items-end gap-0.5">
              {directStt.volumeBars.map((v, i) => (
                <div
                  key={i}
                  className="w-1 rounded-full bg-orange-500 transition-all duration-150"
                  style={{ height: `${Math.max(4, v * 24)}px` }}
                />
              ))}
            </div>
            <span className="font-mono text-xs">
              {directStt.formatTime(directStt.recordingTime)}
            </span>
          </div>
        )}
        {directStt.recordingState === "transcribing" && (
          <div className="mb-2 flex items-center gap-2 text-sm text-orange-600">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Transcribing...</span>
          </div>
        )}

        {/* Controls */}
        <div className="mb-6 flex gap-3">
          <button
            onClick={handleDirectMicClick}
            disabled={
              directStt.recordingState === "transcribing" ||
              status === "connecting" ||
              status === "streaming" ||
              audioPlayback.isPlaying ||
              bufferedPlaying
            }
            className={`rounded px-3 py-2 transition-colors disabled:cursor-default disabled:bg-gray-300 ${
              directStt.recordingState === "recording"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-orange-100 text-orange-700 hover:bg-orange-200"
            }`}
            title={
              directStt.recordingState === "recording"
                ? "Stop recording"
                : "Record voice → fill text"
            }
          >
            {directStt.recordingState === "recording" ? (
              <Square className="h-4 w-4" />
            ) : directStt.recordingState === "transcribing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={handleSpeak}
            disabled={
              status === "connecting" ||
              status === "streaming" ||
              audioPlayback.isPlaying ||
              bufferedPlaying ||
              directStt.recordingState !== "idle"
            }
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
            <span>
              E2E Roleplay Test{" "}
              <span className="font-normal text-gray-600">
                (unified WebSocket: LLM + TTS)
              </span>
            </span>
            <span className="text-gray-500">{e2eOpen ? "▾" : "▸"}</span>
          </button>

          {e2eOpen && (
            <div className="border-t border-gray-200 p-4">
              {/* E2E status bar */}
              <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded bg-gray-50 px-4 py-2 text-xs font-mono">
                <span>
                  Status:{" "}
                  <span className={e2eStatusColor(e2e.status)}>
                    {e2e.status}
                  </span>
                </span>
                <span>
                  Session:{" "}
                  <span
                    className={
                      e2e.sessionId ? "text-green-600" : "text-gray-500"
                    }
                  >
                    {e2e.sessionId ? "connected" : "closed"}
                  </span>
                </span>
                <span>
                  Chunks:{" "}
                  <span className="text-gray-700">
                    {e2e.audioChunksReceived}
                  </span>
                </span>
                <span>
                  Playing:{" "}
                  <span
                    className={
                      e2e.isPlaying ? "text-green-600" : "text-gray-500"
                    }
                  >
                    {e2e.isPlaying ? "yes" : "no"}
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
                {e2e.messages.length === 0 && !e2e.streamingContent && (
                  <span className="text-gray-600">
                    Send a message to start the roleplay...
                  </span>
                )}
                {e2e.messages.map((m, i) => (
                  <div
                    key={i}
                    className={`mb-2 ${m.role === "user" ? "text-blue-600" : "text-gray-800"}`}
                  >
                    <span className="text-xs font-medium text-gray-500">
                      {m.role === "user" ? "You" : "Jordan"}:{" "}
                    </span>
                    {m.content}
                  </div>
                ))}
                {e2e.streamingContent && (
                  <div className="mb-2 text-gray-800">
                    <span className="text-xs font-medium text-gray-500">
                      Jordan:{" "}
                    </span>
                    {e2e.streamingContent}
                    <span className="animate-pulse text-gray-500">|</span>
                  </div>
                )}
              </div>

              {/* E2E Recording indicator */}
              {e2eStt.recordingState === "recording" && (
                <div className="mb-2 flex items-center gap-3 text-sm text-orange-600">
                  <div className="flex items-end gap-0.5">
                    {e2eStt.volumeBars.map((v, i) => (
                      <div
                        key={i}
                        className="w-1 rounded-full bg-orange-500 transition-all duration-150"
                        style={{ height: `${Math.max(4, v * 24)}px` }}
                      />
                    ))}
                  </div>
                  <span className="font-mono text-xs">
                    {e2eStt.formatTime(e2eStt.recordingTime)}
                  </span>
                </div>
              )}
              {e2eStt.recordingState === "transcribing" && (
                <div className="mb-2 flex items-center gap-2 text-sm text-orange-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Transcribing...</span>
                </div>
              )}

              {/* Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  disabled={e2eStt.recordingState !== "idle"}
                  className="flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none disabled:bg-gray-50"
                  placeholder={
                    e2eStt.recordingState === "recording"
                      ? "Recording..."
                      : e2eStt.recordingState === "transcribing"
                        ? "Transcribing..."
                        : "Type a message..."
                  }
                  onKeyDown={(e) => e.key === "Enter" && handleSendAndSpeak()}
                />
                <button
                  onClick={handleE2eMicClick}
                  disabled={
                    e2eStt.recordingState === "transcribing" ||
                    e2e.status === "streaming"
                  }
                  className={`rounded px-3 py-2 transition-colors disabled:cursor-default disabled:bg-gray-300 ${
                    e2eStt.recordingState === "recording"
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                  }`}
                  title={
                    e2eStt.recordingState === "recording"
                      ? "Stop recording"
                      : "Record voice → auto-send"
                  }
                >
                  {e2eStt.recordingState === "recording" ? (
                    <Square className="h-4 w-4" />
                  ) : e2eStt.recordingState === "transcribing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={() => handleSendAndSpeak()}
                  disabled={
                    e2e.status === "streaming" ||
                    !userInput.trim() ||
                    e2eStt.recordingState !== "idle"
                  }
                  className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-300"
                >
                  Send &amp; Speak
                </button>
              </div>

              {/* Test config info */}
              <div className="mt-3 text-xs text-gray-600">
                <strong className="text-gray-500">Test config:</strong> module=
                {TEST_CONFIG.moduleSlug}, roleplay=
                {TEST_CONFIG.roleplayId.slice(0, 8)}..., character=Jordan Chen,
                voice={voice}, model={model}
              </div>
            </div>
          )}
        </div>

        {/* Log panel */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-400">Event Log</h2>
            <button
              onClick={() => {
                setLogs([]);
                logStartRef.current = 0;
              }}
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
