// src/validator/timestamps.ts
import type { ContentError } from '../index.js';
import { parseTimestamp } from '../bundler/video.js';

export function validateTimestamps(content: string, file: string): ContentError[] {
  const errors: ContentError[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    errors.push({
      file,
      line: 1,
      message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      severity: 'error',
    });
    return errors;
  }

  if (!Array.isArray(parsed)) {
    errors.push({
      file,
      line: 1,
      message: 'Timestamps file must contain a JSON array',
      severity: 'error',
    });
    return errors;
  }

  if (parsed.length === 0) {
    errors.push({
      file,
      line: 1,
      message: 'Timestamps array is empty',
      severity: 'warning',
    });
    return errors;
  }

  let prevSeconds: number | null = null;

  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i] as Record<string, unknown>;

    if (typeof entry.text !== 'string' && entry.text !== undefined) {
      errors.push({
        file,
        message: `Entry ${i}: 'text' must be a string`,
        severity: 'error',
      });
    } else if (entry.text === undefined) {
      errors.push({
        file,
        message: `Entry ${i}: missing required field 'text'`,
        severity: 'error',
      });
    }

    if (entry.start === undefined) {
      errors.push({
        file,
        message: `Entry ${i}: missing required field 'start'`,
        severity: 'error',
      });
    } else if (typeof entry.start === 'string') {
      const seconds = parseTimestamp(entry.start);
      if (seconds === null) {
        errors.push({
          file,
          message: `Entry ${i}: invalid timestamp format '${entry.start}'`,
          suggestion: 'Use format M:SS.ms (e.g., 0:01.32)',
          severity: 'error',
        });
      } else {
        if (prevSeconds !== null && seconds < prevSeconds) {
          errors.push({
            file,
            message: `Entry ${i}: non-monotonic timestamp '${entry.start}' (previous was later)`,
            severity: 'warning',
          });
        }
        prevSeconds = seconds;
      }
    } else {
      errors.push({
        file,
        message: `Entry ${i}: 'start' must be a string, got ${typeof entry.start}`,
        suggestion: "Use string format like '0:01.32' instead of a number",
        severity: 'error',
      });
    }
  }

  return errors;
}
