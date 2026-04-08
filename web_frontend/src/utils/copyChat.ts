import type { ChatMessage } from "@/types/module";

const ROLE_LABELS: Record<string, string> = {
  user: "You",
  assistant: "Tutor",
  "course-content": "Lens",
};

/** Format a conversation as readable plain text. */
export function formatConversationText(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    // Skip system messages, tool messages, and empty assistant messages
    if (msg.role === "system" || msg.role === "tool") continue;
    if (msg.role === "assistant" && "tool_calls" in msg && msg.tool_calls && !msg.content?.trim()) continue;
    if (!msg.content?.trim()) continue;

    const label = ROLE_LABELS[msg.role] ?? msg.role;
    lines.push(`${label}:\n${msg.content.trim()}`);
  }
  return lines.join("\n\n");
}

/** Copy text to clipboard. Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
