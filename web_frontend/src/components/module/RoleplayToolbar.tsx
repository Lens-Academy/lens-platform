/**
 * RoleplayToolbar - Three independent toggle icons for roleplay settings.
 *
 * Controls: text display, TTS, and input mode (text/voice).
 * Each toggle is independent - all combinations are valid.
 */

import {
  MessageSquare,
  EyeOff,
  Volume2,
  VolumeX,
  Keyboard,
  Mic,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

type RoleplayToolbarProps = {
  textDisplay: boolean;
  ttsEnabled: boolean;
  inputMode: "text" | "voice";
  onToggleText: () => void;
  onToggleTTS: () => void;
  onToggleInput: () => void;
  disabled?: boolean;
};

export default function RoleplayToolbar({
  textDisplay,
  ttsEnabled,
  inputMode,
  onToggleText,
  onToggleTTS,
  onToggleInput,
  disabled,
}: RoleplayToolbarProps) {
  const buttonBase =
    "min-w-[36px] min-h-[36px] p-2 rounded-lg transition-colors";
  const activeClass = "bg-indigo-100 text-indigo-700";
  const inactiveClass = "text-gray-400 hover:text-gray-600 hover:bg-gray-100";
  const disabledClass = "opacity-50 cursor-default";

  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-100">
      <Tooltip content={textDisplay ? "Hide text" : "Show text"}>
        <button
          type="button"
          onClick={disabled ? undefined : onToggleText}
          className={`${buttonBase} ${textDisplay ? activeClass : inactiveClass} ${disabled ? disabledClass : ""}`}
          aria-label={textDisplay ? "Hide message text" : "Show message text"}
        >
          {textDisplay ? (
            <MessageSquare size={18} />
          ) : (
            <EyeOff size={18} />
          )}
        </button>
      </Tooltip>

      <Tooltip content={ttsEnabled ? "Mute voice" : "Enable voice"}>
        <button
          type="button"
          onClick={disabled ? undefined : onToggleTTS}
          className={`${buttonBase} ${ttsEnabled ? activeClass : inactiveClass} ${disabled ? disabledClass : ""}`}
          aria-label={ttsEnabled ? "Disable text-to-speech" : "Enable text-to-speech"}
        >
          {ttsEnabled ? (
            <Volume2 size={18} />
          ) : (
            <VolumeX size={18} />
          )}
        </button>
      </Tooltip>

      <Tooltip content={inputMode === "text" ? "Switch to voice" : "Switch to text"}>
        <button
          type="button"
          onClick={disabled ? undefined : onToggleInput}
          className={`${buttonBase} ${inputMode === "voice" ? activeClass : inactiveClass} ${disabled ? disabledClass : ""}`}
          aria-label={inputMode === "text" ? "Switch to voice input" : "Switch to text input"}
        >
          {inputMode === "text" ? (
            <Keyboard size={18} />
          ) : (
            <Mic size={18} />
          )}
        </button>
      </Tooltip>
    </div>
  );
}
