import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../../types/lesson";

type ChatPanelProps = {
  messages: ChatMessage[];
  onSendMessage: (content: string) => void;
  isLoading: boolean;
  placeholder?: string;
};

export default function ChatPanel({
  messages,
  onSendMessage,
  isLoading,
  placeholder = "Type your response...",
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
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

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-gray-200">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
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
    </div>
  );
}
