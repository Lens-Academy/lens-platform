// web_frontend/src/components/unified-lesson/ChatPanel.tsx
import { useState, useRef, useEffect } from "react";
import type { ChatMessage, Stage, PendingMessage } from "../../types/unified-lesson";

type ChatPanelProps = {
  messages: ChatMessage[];
  pendingMessage: PendingMessage | null;
  onSendMessage: (content: string) => void;
  onRetryMessage: () => void;
  isLoading: boolean;
  streamingContent: string;
  currentStage: Stage | null;
  pendingTransition: boolean;
  onConfirmTransition: () => void;
  onContinueChatting: () => void;
  showDisclaimer?: boolean;
  isReviewing?: boolean;
};

export default function ChatPanel({
  messages,
  pendingMessage,
  onSendMessage,
  onRetryMessage,
  isLoading,
  streamingContent,
  currentStage,
  pendingTransition,
  onConfirmTransition,
  onContinueChatting,
  showDisclaimer = false,
  isReviewing = false,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, pendingMessage]);

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
        {messages.map((msg, i) =>
          msg.role === "system" ? (
            <div key={i} className="flex justify-center my-3">
              <span className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                {msg.content}
              </span>
            </div>
          ) : (
            <div
              key={i}
              className={`p-3 rounded-lg ${
                msg.role === "assistant"
                  ? "bg-blue-50 text-gray-800"
                  : "bg-gray-100 text-gray-800 ml-8"
              }`}
            >
              <div className="text-xs text-gray-500 mb-1">
                {msg.role === "assistant" ? "Tutor" : "You"}
              </div>
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          )
        )}

        {/* Pending user message (optimistic) */}
        {pendingMessage && (
          <div className={`p-3 rounded-lg ml-8 ${
            pendingMessage.status === "failed"
              ? "bg-red-50 border border-red-200"
              : "bg-gray-100"
          }`}>
            <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
              <span>You</span>
              {pendingMessage.status === "sending" && (
                <span className="text-gray-400">Sending...</span>
              )}
              {pendingMessage.status === "failed" && (
                <button
                  onClick={onRetryMessage}
                  className="text-red-600 hover:text-red-700 text-xs"
                >
                  Failed - Click to retry
                </button>
              )}
            </div>
            <div className="whitespace-pre-wrap text-gray-800">{pendingMessage.content}</div>
          </div>
        )}

        {/* Streaming message */}
        {isLoading && streamingContent && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Tutor</div>
            <div className="whitespace-pre-wrap">{streamingContent}</div>
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && !streamingContent && (
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="text-xs text-gray-500 mb-1">Tutor</div>
            <div className="text-gray-500">Thinking...</div>
          </div>
        )}

        {/* Transition prompt */}
        {pendingTransition && (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
            <p className="text-yellow-800 mb-3">Ready to continue to the next part?</p>
            <div className="flex gap-2">
              <button
                onClick={onConfirmTransition}
                className="bg-yellow-600 text-white px-4 py-2 rounded hover:bg-yellow-700"
              >
                Continue
              </button>
              <button
                onClick={onContinueChatting}
                className="bg-white text-yellow-700 px-4 py-2 rounded border border-yellow-300 hover:bg-yellow-50"
              >
                Keep chatting
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Disclaimer when not in chat stage */}
      {showDisclaimer && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 relative z-20">
          {isReviewing ? (
            <>
              <p className="text-sm font-medium text-gray-800">You're reviewing a previous article/video</p>
              <p className="text-sm text-gray-500 mt-1">
                You can ask the AI tutor questions, but it doesn't know that you're reviewing older content.
              </p>
            </>
          ) : currentStage?.type === "article" ? (
            <>
              <p className="text-sm font-medium text-gray-800">Please read the article</p>
              <p className="text-sm text-gray-500 mt-1">
                You can already chat with the AI tutor about it, but there will also be a dedicated chat section after reading the article.
              </p>
            </>
          ) : currentStage?.type === "video" ? (
            <>
              <p className="text-sm font-medium text-gray-800">Please watch the video</p>
              <p className="text-sm text-gray-500 mt-1">
                You can already chat with the AI tutor about it, but there will also be a dedicated chat section after watching the video.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500">Feel free to ask questions.</p>
          )}
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t border-gray-200">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isLoading}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
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
