// web_frontend/src/components/lesson-prototypes/prototype-c/CheckpointModal.tsx

import type { ChatState } from "../shared/types";
import { SimpleChatBox } from "../shared/SimpleChatBox";

type CheckpointModalProps = {
  isOpen: boolean;
  prompt?: string;
  chatState: ChatState;
  onSendMessage: (content: string) => void;
  onClose: () => void;
};

export function CheckpointModal({
  isOpen,
  prompt,
  chatState,
  onSendMessage,
  onClose,
}: CheckpointModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col animate-modal-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">
            Let&apos;s discuss
          </h3>
          {prompt && <p className="text-gray-600 text-sm mt-1">{prompt}</p>}
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-hidden">
          <SimpleChatBox
            chatState={chatState}
            onSendMessage={onSendMessage}
            placeholder="Share your thoughts..."
            className="h-full"
          />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            disabled={chatState.messages.length === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-default"
          >
            Continue watching
          </button>
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .animate-modal-in {
          animation: modalIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
