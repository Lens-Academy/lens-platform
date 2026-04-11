/**
 * VoiceInputBar - Push-to-talk mic button for roleplay voice input mode.
 *
 * Click mic to start recording, click again to send (transcribes and sends
 * immediately, no review step). Cancel button (X) discards without sending.
 *
 * Uses useVoiceRecording hook internally with onTranscription calling onSend
 * directly -- the key difference from ChatInputArea's mic-fills-textarea approach.
 */

import { useState, useRef } from "react";
import { Mic, X, Loader2 } from "lucide-react";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";

type VoiceInputBarProps = {
  onSend: (text: string) => void;
  isLoading: boolean;
  disabled?: boolean;
};

export default function VoiceInputBar({
  onSend,
  isLoading,
  disabled,
}: VoiceInputBarProps) {
  const [isSending, setIsSending] = useState(false);
  const cancelRef = useRef(false);

  const {
    recordingState,
    recordingTime,
    volumeBars,
    handleMicClick,
    formatTime,
  } = useVoiceRecording({
    onTranscription: (text) => {
      // If cancel was pressed, ignore the transcription result
      if (cancelRef.current) {
        cancelRef.current = false;
        return;
      }
      setIsSending(true);
      onSend(text);
      // Brief visual feedback then reset
      setTimeout(() => setIsSending(false), 500);
    },
  });

  const handleCancel = () => {
    if (recordingState === "recording") {
      // Set cancel flag before stopping so onTranscription ignores the result
      cancelRef.current = true;
      handleMicClick(); // Stops recording (triggers transcription, but cancel flag will suppress it)
    }
  };

  const isRecording = recordingState === "recording";
  const isTranscribing = recordingState === "transcribing";
  const micDisabled = disabled || isLoading || isTranscribing || isSending;

  return (
    <div className="flex flex-col items-center py-4 px-4">
      <div className="flex items-center justify-center gap-4">
        {/* Cancel button - only during recording */}
        {isRecording && (
          <button
            type="button"
            onClick={handleCancel}
            className="w-10 h-10 rounded-full bg-red-100 text-red-500 hover:bg-red-200 flex items-center justify-center transition-colors"
            aria-label="Cancel recording"
          >
            <X size={18} />
          </button>
        )}

        {/* Main mic button */}
        <button
          type="button"
          onClick={micDisabled ? undefined : handleMicClick}
          className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
            isRecording
              ? "bg-red-500 text-white animate-pulse"
              : isTranscribing || isSending
                ? "bg-gray-200 text-gray-400"
                : micDisabled
                  ? "bg-gray-100 text-gray-300 cursor-default"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
          aria-label={
            isRecording
              ? "Stop recording and send"
              : isTranscribing
                ? "Transcribing..."
                : "Start recording"
          }
        >
          {isTranscribing || isSending ? (
            <Loader2 size={24} className="animate-spin" />
          ) : (
            <Mic size={24} />
          )}
        </button>
      </div>

      {/* Volume bars and timer during recording */}
      {isRecording && (
        <div className="flex items-center gap-2 mt-3">
          <div className="flex items-end gap-1 h-6">
            {volumeBars.map((vol, i) => (
              <div
                key={i}
                className="w-1.5 bg-red-400 rounded-sm transition-[height] duration-100"
                style={{
                  height: `${Math.max(6, Math.min(1, vol * 2) * 24)}px`,
                }}
              />
            ))}
          </div>
          <span className="text-sm text-gray-500 tabular-nums">
            {formatTime(recordingTime)}
          </span>
        </div>
      )}

      {/* Sending feedback */}
      {isSending && (
        <div className="text-sm text-gray-400 mt-2">Sending...</div>
      )}
    </div>
  );
}
