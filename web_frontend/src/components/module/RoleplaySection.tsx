/**
 * RoleplaySection - Main roleplay conversation component.
 *
 * Wires together all roleplay hooks (session, toggles, TTS) and sub-components
 * (briefing, toolbar, voice input, speaking indicator) into the full user-facing
 * roleplay experience.
 *
 * Manages its own state entirely -- separate from Module.tsx's shared chat state
 * (Pitfall 2: no cross-contamination with tutor chat).
 */

import { useState, useEffect } from "react";
import type { RoleplaySegment } from "@/types/module";
import { useRoleplaySession } from "@/hooks/useRoleplaySession";
import { useRoleplayToggles } from "@/hooks/useRoleplayToggles";
import { useRoleplayTTS } from "@/hooks/useRoleplayTTS";
import { extractCharacterName } from "@/utils/extractCharacterName";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { triggerHaptic } from "@/utils/haptics";
import ChatMarkdown from "@/components/ChatMarkdown";
import RoleplayBriefing from "./RoleplayBriefing";
import RoleplayToolbar from "./RoleplayToolbar";
import VoiceInputBar from "./VoiceInputBar";
import SpeakingIndicator from "./SpeakingIndicator";

type RoleplaySectionProps = {
  segment: RoleplaySegment;
  moduleSlug: string;
};

export default function RoleplaySection({
  segment,
  moduleSlug,
}: RoleplaySectionProps) {
  const {
    messages,
    pendingMessage,
    streamingContent,
    isLoading,
    isCompleted,
    lastAssistantResponse,
    sendMessage,
    complete,
    retry,
  } = useRoleplaySession(
    moduleSlug,
    segment.id,
    segment.aiInstructions,
    segment.content,
    segment.openingMessage,
  );

  const {
    textDisplay,
    ttsEnabled,
    inputMode,
    toggleTextDisplay,
    toggleTTS,
    toggleInputMode,
  } = useRoleplayToggles(segment.id);

  const { speakText, stop: stopTTS } = useRoleplayTTS(ttsEnabled);
  const characterName = extractCharacterName(segment.aiInstructions);

  // Text mode: optional STT fills textarea (same as tutor chat)
  const [textInput, setTextInput] = useState("");
  const {
    recordingState,
    handleMicClick,
  } = useVoiceRecording({
    onTranscription: (text) =>
      setTextInput((prev) => (prev ? `${prev} ${text}` : text)),
  });

  // TTS: speak completed assistant responses
  useEffect(() => {
    if (lastAssistantResponse && ttsEnabled) {
      speakText(lastAssistantResponse);
    }
  }, [lastAssistantResponse, ttsEnabled, speakText]);

  // Stop TTS on complete or retry
  const handleComplete = async () => {
    stopTTS();
    await complete();
  };
  const handleRetry = async () => {
    stopTTS();
    await retry();
  };

  // Send from text input
  const handleTextSend = () => {
    if (textInput.trim() && !isLoading) {
      triggerHaptic(10);
      sendMessage(textInput.trim());
      setTextInput("");
    }
  };

  return (
    <div className="py-4 px-4" style={{ overflowAnchor: "none" }}>
      <div className="max-w-content-padded mx-auto">
        {/* Briefing card -- always visible */}
        <RoleplayBriefing content={segment.content} />

        {/* Toolbar -- three toggles */}
        <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
          <RoleplayToolbar
            textDisplay={textDisplay}
            ttsEnabled={ttsEnabled}
            inputMode={inputMode}
            onToggleText={toggleTextDisplay}
            onToggleTTS={toggleTTS}
            onToggleInput={toggleInputMode}
            disabled={isCompleted}
          />

          {/* Conversation area */}
          <div className="px-4 py-4">
            {textDisplay ? (
              /* Full message list */
              <div className="space-y-4">
                {messages.map((msg, i) =>
                  msg.role === "assistant" ? (
                    <div key={i} className="text-gray-800">
                      <div className="text-sm text-indigo-600 font-medium mb-1">
                        {characterName}
                      </div>
                      <div className="bg-indigo-50 rounded-2xl p-3">
                        <ChatMarkdown>{msg.content}</ChatMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={i}
                      className="ml-auto max-w-[80%] bg-gray-100 text-gray-800 p-3 rounded-2xl"
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  ),
                )}

                {/* Pending user message */}
                {pendingMessage && (
                  <div
                    className={`ml-auto max-w-[80%] p-3 rounded-2xl ${
                      pendingMessage.status === "failed"
                        ? "bg-red-50 border border-red-200"
                        : "bg-gray-100"
                    }`}
                  >
                    <div className="whitespace-pre-wrap text-gray-800">
                      {pendingMessage.content}
                    </div>
                  </div>
                )}

                {/* Streaming response */}
                {isLoading && streamingContent && (
                  <div className="text-gray-800">
                    <div className="text-sm text-indigo-600 font-medium mb-1">
                      {characterName}
                    </div>
                    <div className="bg-indigo-50 rounded-2xl p-3">
                      <ChatMarkdown>{streamingContent}</ChatMarkdown>
                    </div>
                  </div>
                )}

                {/* Thinking indicator */}
                {isLoading && !streamingContent && (
                  <div className="text-gray-800">
                    <div className="text-sm text-indigo-600 font-medium mb-1">
                      {characterName}
                    </div>
                    <div className="bg-indigo-50 rounded-2xl p-3 text-gray-500">
                      Thinking...
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Text-off mode: speaking indicator */
              <SpeakingIndicator
                speaker={isLoading ? characterName : null}
                isUserTurn={!isLoading && !isCompleted}
              />
            )}
          </div>

          {/* Input area */}
          {!isCompleted ? (
            <div className="border-t border-gray-100 px-4 py-3">
              {inputMode === "text" ? (
                /* Text input with optional STT mic (same pattern as NarrativeChatSection) */
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleTextSend();
                  }}
                  className="flex gap-2 items-end"
                >
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleTextSend();
                      }
                    }}
                    placeholder={
                      recordingState === "transcribing"
                        ? "Transcribing..."
                        : "Type a message..."
                    }
                    disabled={isLoading || recordingState === "transcribing"}
                    rows={1}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none leading-normal disabled:bg-gray-50 bg-transparent"
                  />
                  <div className="flex gap-1.5 shrink-0">
                    {/* Optional STT mic for text mode */}
                    <button
                      type="button"
                      onClick={handleMicClick}
                      disabled={recordingState === "transcribing"}
                      className="min-w-[36px] min-h-[36px] p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-default"
                      aria-label={
                        recordingState === "recording"
                          ? "Stop recording"
                          : "Start voice recording"
                      }
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                        />
                      </svg>
                    </button>
                    {/* Send button */}
                    <button
                      type="submit"
                      disabled={
                        isLoading ||
                        !textInput.trim() ||
                        recordingState !== "idle"
                      }
                      className="bg-indigo-600 text-white p-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-default min-w-[36px] min-h-[36px]"
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
                        />
                      </svg>
                    </button>
                  </div>
                </form>
              ) : (
                /* Voice input mode: push-to-talk */
                <VoiceInputBar
                  onSend={sendMessage}
                  isLoading={isLoading}
                  disabled={isCompleted}
                />
              )}

              {/* Complete button -- right-aligned below input */}
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleComplete}
                  disabled={isLoading || messages.length === 0}
                  className="text-sm px-4 py-1.5 border border-gray-300 rounded-full text-gray-600 hover:text-gray-800 hover:border-gray-400 disabled:opacity-50 disabled:cursor-default transition-colors"
                >
                  Complete
                </button>
              </div>
            </div>
          ) : (
            /* Done state */
            <div className="border-t border-gray-100 px-4 py-6 text-center">
              <div className="text-sm text-gray-500 mb-3">
                Conversation complete
              </div>
              <button
                onClick={handleRetry}
                className="text-sm px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
