// web_frontend/src/components/lesson-prototypes/shared/SimpleChatBox.tsx

import { useState } from "react";
import type { ChatState } from "./types";

type SimpleChatBoxProps = {
  chatState: ChatState;
  onSendMessage: (content: string) => void;
  placeholder?: string;
  className?: string;
  compact?: boolean;
};

export function SimpleChatBox({
  chatState,
  onSendMessage,
  placeholder = "Type your response...",
  className = "",
  compact = false,
}: SimpleChatBoxProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || chatState.isStreaming) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const messageClass = compact ? "text-sm py-2 px-3" : "py-3 px-4";
  const inputClass = compact ? "text-sm p-2" : "p-3";

  return (
    <div className={`flex flex-col bg-gray-50 rounded-lg ${className}`}>
      {/* Messages */}
      <div
        className={`flex-1 overflow-y-auto ${compact ? "max-h-48" : "max-h-80"} space-y-2 p-3`}
      >
        {chatState.messages.map((msg, i) => (
          <div
            key={i}
            className={`${messageClass} rounded-lg ${
              msg.role === "user"
                ? "bg-blue-100 text-blue-900 ml-8"
                : "bg-white text-gray-800 mr-8 border border-gray-200"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {chatState.isStreaming && chatState.streamingContent && (
          <div
            className={`${messageClass} rounded-lg bg-white text-gray-800 mr-8 border border-gray-200`}
          >
            {chatState.streamingContent}
            <span className="animate-pulse">▊</span>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={chatState.isStreaming}
            className={`flex-1 border border-gray-300 rounded-lg ${inputClass} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          <button
            type="submit"
            disabled={!input.trim() || chatState.isStreaming}
            className={`bg-blue-600 text-white rounded-lg px-4 ${inputClass} disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700`}
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
