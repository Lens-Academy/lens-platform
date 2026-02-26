/**
 * TTS Pipeline Test - Test harness for verifying the full TTS pipeline.
 *
 * NOT production UI. This page exists to prove that:
 * 1. Text goes in via WebSocket to /ws/tts
 * 2. Audio chunks come back as binary frames
 * 3. Audio plays via Web Audio API before all chunks arrive (streaming)
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

const TTS_MODELS = [
  "inworld-tts-1.5-mini",
  "inworld-tts-1.5-max",
  "inworld-tts-1",
  "inworld-tts-1-max",
] as const;

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export default function Page() {
  const [text, setText] = useState(
    "Hello, I am an AI safety researcher. Let me tell you about alignment.",
  );
  const [voice, setVoice] = useState("Ashley");
  const [model, setModel] = useState<string>(TTS_MODELS[0]);
  const [voices, setVoices] = useState<InworldVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [mode, setMode] = useState<PlaybackMode>("buffered");
  const wsRef = useRef<WebSocket | null>(null);
  const chunksBufferRef = useRef<Blob[]>([]);
  // <audio> element for buffered playback (pitch-preserving speed control)
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const audioPlayback = useAudioPlayback();
  const [speed, setSpeed] = useState(1.0);
  const [bufferedPlaying, setBufferedPlaying] = useState(false);
  const [simulateStreaming, setSimulateStreaming] = useState(false);
  const [tokenDelay, setTokenDelay] = useState(0.05);

  useEffect(() => {
    fetch("/api/tts/voices")
      .then((res) => res.json())
      .then((data: InworldVoice[]) => {
        setVoices(data);
        // Default to Ashley if present
        if (data.length > 0 && !data.some((v) => v.voiceId === "Ashley")) {
          setVoice(data[0].voiceId);
        }
      })
      .catch(() => setVoices([]))
      .finally(() => setVoicesLoading(false));
  }, []);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${timestamp()}] ${msg}`]);
  }, []);

  const handleSpeak = useCallback(async () => {
    if (!text.trim()) {
      addLog("ERROR: No text to synthesize");
      return;
    }

    // Reset state
    setLogs([]);
    setStatus("connecting");
    audioPlayback.stop();
    chunksBufferRef.current = [];

    // Resume AudioContext from user gesture (required by autoplay policy)
    try {
      await audioPlayback.resume();
      addLog("AudioContext resumed (user gesture)");
    } catch (err) {
      addLog(`ERROR: Failed to resume AudioContext: ${err}`);
      setStatus("error");
      return;
    }

    // Construct WebSocket URL using current page origin
    // In dev: Vite proxy forwards /ws/* to backend
    // In prod: same-origin, served by FastAPI
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${location.host}/ws/tts`;
    addLog(`Connecting to ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      addLog("WebSocket connected");
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
        addLog(`Simulate LLM streaming: ON (delay=${tokenDelay}s/token, ~${text.trim().split(/\s+/).length} tokens)`);
      }
      addLog(`Sending: ${payload.slice(0, 120)}${payload.length > 120 ? "..." : ""}`);
      ws.send(payload);
    };

    const currentMode = mode;
    const currentSpeed = speed;

    // Streaming: server applies speakingRate, so set client playback to 1.0
    // Buffered: client applies speed via <audio>.playbackRate
    if (currentMode === "streaming") {
      audioPlayback.setPlaybackRate(1.0);
    }

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        // Binary frame = audio chunk
        if (currentMode === "streaming") {
          const bytes = await event.data.arrayBuffer();
          addLog(`Audio chunk: ${bytes.byteLength} bytes`);
          try {
            await audioPlayback.playChunk(bytes);
          } catch (err) {
            addLog(`ERROR: playChunk failed: ${err}`);
          }
        } else {
          // Buffered: push Blob directly — NO await before push.
          // Awaiting event.data.arrayBuffer() would yield to the event loop,
          // letting the done=true handler race ahead and merge without
          // the last chunk(s).
          addLog(`Audio chunk: ${event.data.size} bytes`);
          chunksBufferRef.current.push(event.data);
        }
      } else {
        // Text frame = JSON control message
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.done) {
            addLog("Server: synthesis complete (done=true)");

            if (currentMode === "buffered" && chunksBufferRef.current.length > 0) {
              // Merge Blob chunks into one MP3 blob
              const chunks = chunksBufferRef.current;
              const totalLen = chunks.reduce((sum, c) => sum + c.size, 0);
              const blob = new Blob(chunks, { type: "audio/mpeg" });
              addLog(`Playing buffered audio: ${totalLen} bytes in ${chunks.length} chunks (blob: ${blob.size} bytes)`);

              // Use <audio> element for pitch-preserving speed control
              if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
              const url = URL.createObjectURL(blob);
              blobUrlRef.current = url;
              const audio = new Audio(url);
              audioElRef.current = audio;
              audio.playbackRate = currentSpeed;
              audio.onloadedmetadata = () => {
                addLog(`Audio duration: ${audio.duration.toFixed(3)}s (speed: ${audio.playbackRate}x)`);
              };
              audio.onended = () => {
                addLog("Buffered playback finished");
                audioElRef.current = null;
                URL.revokeObjectURL(url);
                blobUrlRef.current = null;
                setBufferedPlaying(false);
                setStatus("idle");
              };
              audio.onerror = () => {
                addLog(`ERROR: <audio> playback failed`);
                setBufferedPlaying(false);
                setStatus("error");
              };
              setBufferedPlaying(true);
              try {
                await audio.play();
              } catch (err) {
                addLog(`ERROR: buffered play failed: ${err}`);
                setBufferedPlaying(false);
                setStatus("error");
              }
              chunksBufferRef.current = [];
              // Don't set status="done" — onended will set "idle"
            } else {
              setStatus("done");
            }
          } else if (msg.error) {
            addLog(`Server ERROR: ${msg.error}`);
            setStatus("error");
          } else {
            addLog(`Server message: ${JSON.stringify(msg)}`);
          }
        } catch {
          addLog(`Server text: ${event.data}`);
        }
      }
    };

    ws.onerror = () => {
      addLog("WebSocket error");
      setStatus("error");
    };

    ws.onclose = (event: CloseEvent) => {
      addLog(`WebSocket closed (code=${event.code}, reason=${event.reason || "none"})`);
      wsRef.current = null;
    };
  }, [text, voice, model, mode, speed, simulateStreaming, tokenDelay, audioPlayback, addLog]);

  const handleStop = useCallback(() => {
    addLog("Stopping playback");
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

  const statusColor: Record<Status, string> = {
    idle: "text-gray-400",
    connecting: "text-yellow-400",
    streaming: "text-green-400",
    buffering: "text-yellow-400",
    done: "text-blue-400",
    error: "text-red-400",
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">TTS Pipeline Test</h1>
        <a href="/voice-test" className="text-sm text-blue-400 hover:text-blue-300">
          Voice E2E Test →
        </a>
      </div>

      {/* Status indicators */}
      <div className="mb-4 flex gap-6 text-sm">
        <div>
          <span className="text-gray-500">Status: </span>
          <span className={statusColor[status]}>{status}</span>
        </div>
        <div>
          <span className="text-gray-500">AudioContext: </span>
          <span className="text-gray-300">
            {audioPlayback.contextState ?? "none"}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Playing: </span>
          <span className={audioPlayback.isPlaying || bufferedPlaying ? "text-green-400" : "text-gray-400"}>
            {audioPlayback.isPlaying || bufferedPlaying ? "yes" : "no"}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Chunks: </span>
          <span className="text-gray-300">{audioPlayback.chunksReceived}</span>
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
          className="w-full rounded border border-gray-600 bg-gray-800 p-3 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
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
            className="rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
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
            className="w-full rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none disabled:cursor-default disabled:opacity-50"
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
            // Buffered: apply client-side speed live
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
                // Clamp speed to valid range for the new mode
                if (m === "streaming" && speed > 1.5) setSpeed(1.5);
                if (m === "buffered" && speed < 0.7) setSpeed(0.7);
              }}
              className="accent-blue-500"
            />
            <span className={mode === m ? "text-gray-900 font-medium dark:text-white" : "text-gray-500"}>
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
          <span className="text-gray-300">Simulate LLM token streaming</span>
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
              className="w-20 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-white focus:border-blue-500 focus:outline-none"
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
          className="rounded bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-default disabled:bg-gray-600"
        >
          Speak
        </button>
        <button
          onClick={handleStop}
          disabled={status === "idle"}
          className="rounded bg-red-600 px-6 py-2 text-white transition-colors hover:bg-red-700 disabled:cursor-default disabled:bg-gray-600"
        >
          Stop
        </button>
      </div>

      {/* Log panel */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-gray-400">Event Log</h2>
        <div className="h-64 overflow-y-auto rounded bg-gray-900 p-3 font-mono text-xs text-gray-300">
          {logs.length === 0 ? (
            <span className="text-gray-600">
              Click &quot;Speak&quot; to start...
            </span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="leading-5">
                {log}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
