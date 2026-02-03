// src/bundler/video.ts
import type { ContentError } from '../index.js';

export interface VideoExcerptResult {
  from?: number;          // Start time in seconds
  to?: number | null;     // End time in seconds (null = until end)
  transcript?: string;    // Extracted transcript content
  error?: ContentError;
}

/**
 * Parse a timestamp string into seconds.
 *
 * Supports formats:
 * - MM:SS (e.g., "1:30" -> 90)
 * - H:MM:SS (e.g., "1:30:00" -> 5400)
 *
 * @param str - Timestamp string
 * @returns Number of seconds, or null if invalid format
 */
export function parseTimestamp(str: string): number | null {
  // Match M:SS, MM:SS, H:MM:SS, HH:MM:SS patterns
  const parts = str.split(':');

  if (parts.length < 2 || parts.length > 3) {
    return null;
  }

  // Validate all parts are numeric
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
  }

  if (parts.length === 2) {
    // MM:SS format
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    return minutes * 60 + seconds;
  } else {
    // H:MM:SS format
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
}

/**
 * Parse a transcript line to extract its timestamp.
 * Expected format: "M:SS - text" or "H:MM:SS - text"
 *
 * @param line - A line from the transcript
 * @returns The timestamp in seconds, or null if no timestamp found
 */
function parseTranscriptLineTimestamp(line: string): number | null {
  // Match timestamp at start of line: "0:00 - ", "1:30 - ", "1:30:00 - "
  const match = line.match(/^(\d+:\d{2}(?::\d{2})?)\s*-/);
  if (!match) {
    return null;
  }
  return parseTimestamp(match[1]);
}

/**
 * Extract transcript content between two timestamps.
 *
 * @param transcript - The full transcript content
 * @param fromTime - Start timestamp string (e.g., "1:30")
 * @param toTime - End timestamp string (e.g., "5:45")
 * @param file - Source file path for error reporting
 * @returns Extracted transcript with from/to as seconds, or error
 */
export function extractVideoExcerpt(
  transcript: string,
  fromTime: string,
  toTime: string,
  file: string
): VideoExcerptResult {
  // Parse the requested timestamps
  const fromSeconds = parseTimestamp(fromTime);
  if (fromSeconds === null) {
    return {
      error: {
        file,
        message: `Invalid start timestamp format: '${fromTime}'`,
        suggestion: 'Use MM:SS (e.g., 1:30) or H:MM:SS (e.g., 1:30:00) format',
        severity: 'error',
      },
    };
  }

  const toSeconds = parseTimestamp(toTime);
  if (toSeconds === null) {
    return {
      error: {
        file,
        message: `Invalid end timestamp format: '${toTime}'`,
        suggestion: 'Use MM:SS (e.g., 1:30) or H:MM:SS (e.g., 1:30:00) format',
        severity: 'error',
      },
    };
  }

  // Parse the transcript into lines with timestamps
  const lines = transcript.split('\n');
  const timestampedLines: Array<{ timestamp: number; line: string }> = [];

  for (const line of lines) {
    const ts = parseTranscriptLineTimestamp(line);
    if (ts !== null) {
      timestampedLines.push({ timestamp: ts, line });
    }
  }

  // Find lines that fall within the requested range
  // A line is included if its timestamp >= fromSeconds and < toSeconds
  let foundFrom = false;
  let foundTo = false;
  const excerptLines: string[] = [];

  for (const { timestamp, line } of timestampedLines) {
    if (timestamp === fromSeconds) {
      foundFrom = true;
    }
    if (timestamp === toSeconds) {
      foundTo = true;
    }

    // Include lines from fromSeconds up to (but not including) toSeconds
    if (timestamp >= fromSeconds && timestamp < toSeconds) {
      excerptLines.push(line);
    }
  }

  if (!foundFrom) {
    return {
      error: {
        file,
        message: `Start timestamp '${fromTime}' not found in transcript`,
        suggestion: 'Check that the timestamp exists as a line marker in the transcript',
        severity: 'error',
      },
    };
  }

  if (!foundTo) {
    return {
      error: {
        file,
        message: `End timestamp '${toTime}' not found in transcript`,
        suggestion: 'Check that the timestamp exists as a line marker in the transcript',
        severity: 'error',
      },
    };
  }

  return {
    from: fromSeconds,
    to: toSeconds,
    transcript: excerptLines.join('\n'),
  };
}
