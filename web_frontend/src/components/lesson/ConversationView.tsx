import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../../types/lesson";

type ConversationViewProps = {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  onSkipToVideo: () => void;
  isLoading: boolean;
  pendingTransition: boolean;
  onConfirmTransition: () => void;
  onContinueChatting: () => void;
};

export default function ConversationView({
  messages,
  onSendMessage,
  onSkipToVideo,
  isLoading,
  pendingTransition,
  onConfirmTransition,
  onContinueChatting,
}: ConversationViewProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${
              msg.role === "assistant"
                ? "bg-blue-50 text-gray-800"
                : "bg-gray-100 text-gray-800 ml-8"
            }`}
          >
            <div className="text-xs text-gray-500 mb-1">
              {msg.role === "assistant" ? "Claude" : "You"}
            </div>
            <div className="whitespace-pre-wrap">{msg.content}</div>
          </div>
        ))}
        {isLoading && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Claude</div>
            <div className="text-gray-500">Thinking...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Transition prompt */}
      {pendingTransition && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
          <p className="text-gray-700 mb-3">
            Ready to watch the next video segment?
          </p>
          <div className="flex gap-2">
            <button
              onClick={onConfirmTransition}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Watch video
            </button>
            <button
              onClick={onContinueChatting}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
            >
              Continue chatting
            </button>
          </div>
        </div>
      )}

      {/* Input form */}
      {!pendingTransition && (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your response..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </form>
      )}

      {/* Skip button */}
      {!pendingTransition && (
        <button
          onClick={onSkipToVideo}
          className="mt-2 text-gray-500 hover:text-gray-700 text-sm underline self-end"
        >
          Skip to video
        </button>
      )}
    </div>
  );
}
