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

import { useState, useRef, useCallback } from "react";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";

type Status = "idle" | "connecting" | "streaming" | "done" | "error";

function timestamp(): string {
  return new Date().toISOString().slice(11, 23);
}

export default function Page() {
  const [text, setText] = useState(
    "Hello, I am an AI safety researcher. Let me tell you about alignment.",
  );
  const [voice, setVoice] = useState("Ashley");
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const audioPlayback = useAudioPlayback();

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

      const payload = JSON.stringify({ text: text.trim(), voice });
      addLog(`Sending: ${payload.slice(0, 100)}${payload.length > 100 ? "..." : ""}`);
      ws.send(payload);
    };

    ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof Blob) {
        // Binary frame = audio chunk
        const bytes = await event.data.arrayBuffer();
        addLog(`Audio chunk: ${bytes.byteLength} bytes`);
        try {
          await audioPlayback.playChunk(bytes);
        } catch (err) {
          addLog(`ERROR: playChunk failed: ${err}`);
        }
      } else {
        // Text frame = JSON control message
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.done) {
            addLog("Server: synthesis complete (done=true)");
            setStatus("done");
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
  }, [text, voice, audioPlayback, addLog]);

  const handleStop = useCallback(() => {
    addLog("Stopping playback");
    audioPlayback.stop();
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
    done: "text-blue-400",
    error: "text-red-400",
  };

  return (
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
          <span className="text-gray-300">
            {audioPlayback.contextState ?? "none"}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Playing: </span>
          <span className={audioPlayback.isPlaying ? "text-green-400" : "text-gray-400"}>
            {audioPlayback.isPlaying ? "yes" : "no"}
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

      {/* Voice selector */}
      <div className="mb-4">
        <label htmlFor="tts-voice" className="mb-1 block text-sm text-gray-400">
          Voice
        </label>
        <input
          id="tts-voice"
          type="text"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="w-48 rounded border border-gray-600 bg-gray-800 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Controls */}
      <div className="mb-6 flex gap-3">
        <button
          onClick={handleSpeak}
          disabled={status === "connecting" || status === "streaming"}
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
