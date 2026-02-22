// src/validator/chat-precedence.ts
import type { ContentError } from '../index.js';

/**
 * Validate that every Chat segment is immediately preceded by a Text segment.
 * Students need instructions (Text) before every interactive discussion (Chat).
 */
export function validateChatPrecedence(
  segments: { type: string; line: number }[],
  file: string,
): ContentError[] {
  const errors: ContentError[] = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].type !== 'chat') continue;

    const prev = segments[i - 1];

    if (!prev) {
      errors.push({
        file,
        line: segments[i].line,
        message: "'#### Chat' must be immediately preceded by a '#### Text' segment, but it is the first segment in the section",
        suggestion: "Add a '#### Text' segment with content:: before this '#### Chat'",
        severity: 'error',
      });
    } else if (prev.type !== 'text') {
      errors.push({
        file,
        line: segments[i].line,
        message: `'#### Chat' must be immediately preceded by a '#### Text' segment, but found '#### ${prev.type}' instead`,
        suggestion: "Add a '#### Text' segment with content:: before this '#### Chat'",
        severity: 'error',
      });
    }
  }

  return errors;
}
