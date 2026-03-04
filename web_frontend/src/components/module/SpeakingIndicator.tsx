/**
 * SpeakingIndicator - Visual feedback when text display is OFF.
 *
 * Shows who is currently active in the conversation:
 * - When AI is responding: character name + pulsing dots
 * - When it's the user's turn: "Your turn" + mic icon
 * - When idle: minimal empty state
 */

import { Mic } from "lucide-react";

type SpeakingIndicatorProps = {
  speaker: string | null; // Character name when AI is responding, null when idle
  isUserTurn: boolean; // Show mic icon when it's user's turn
};

export default function SpeakingIndicator({
  speaker,
  isUserTurn,
}: SpeakingIndicatorProps) {
  if (speaker) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <div className="text-sm font-medium text-indigo-600 mb-3">
          {speaker}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full bg-indigo-400"
            style={{ animation: "pulse-dot 1.4s ease-in-out infinite" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-indigo-400"
            style={{
              animation: "pulse-dot 1.4s ease-in-out infinite",
              animationDelay: "0.2s",
            }}
          />
          <span
            className="w-2 h-2 rounded-full bg-indigo-400"
            style={{
              animation: "pulse-dot 1.4s ease-in-out infinite",
              animationDelay: "0.4s",
            }}
          />
        </div>
        <style>{`
          @keyframes pulse-dot {
            0%, 100% { opacity: 0.3; }
            50% { opacity: 1; }
          }
        `}</style>
      </div>
    );
  }

  if (isUserTurn) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <Mic size={20} className="mb-2 text-gray-400" />
        <div className="text-sm text-gray-400">Your turn</div>
      </div>
    );
  }

  // Idle state - minimal
  return <div className="py-12" />;
}
