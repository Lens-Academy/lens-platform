// src/bundler/video.ts
import type { ContentError } from '../index.js';

export interface VideoExcerptResult {
  from?: number;          // Start time in seconds
  to?: number | null;     // End time in seconds (null = until end)
  transcript?: string;    // Extracted transcript content
  error?: ContentError;
}

/**
 * Word-level timestamp entry from .timestamps.json files.
 */
export interface TimestampEntry {
  text: string;
  start: string;  // Format: "M:SS.ms" (e.g., "0:00.40", "5:23.10")
}

/**
 * Parse a timestamp string into seconds.
 *
 * Supports formats:
 * - MM:SS (e.g., "1:30" -> 90)
 * - H:MM:SS (e.g., "1:30:00" -> 5400)
 * - M:SS.ms (e.g., "0:00.40" -> 0.4) - used in .timestamps.json files
 *
 * @param str - Timestamp string
 * @returns Number of seconds, or null if invalid format
 */
export function parseTimestamp(str: string): number | null {
  // Handle M:SS.ms format (timestamps.json format)
  const msMatch = str.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (msMatch) {
    const minutes = parseInt(msMatch[1], 10);
    const seconds = parseFloat(msMatch[2]);
    return minutes * 60 + seconds;
  }

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
 * Extract words from timestamps data that fall within the requested time range.
 *
 * @param timestamps - Array of word-level timestamp entries
 * @param fromSeconds - Start time in seconds
 * @param toSeconds - End time in seconds
 * @returns Words joined with spaces
 */
export function extractFromTimestamps(
  timestamps: TimestampEntry[],
  fromSeconds: number,
  toSeconds: number
): string {
  const wordsInRange: string[] = [];

  for (const entry of timestamps) {
    const entryTime = parseTimestamp(entry.start);
    if (entryTime === null) continue;

    // Include word if its start time falls within the range
    if (entryTime >= fromSeconds && entryTime <= toSeconds) {
      wordsInRange.push(entry.text);
    }
  }

  return wordsInRange.join(' ');
}

/**
 * Extract transcript content between two timestamps.
 *
 * If timestamps data (from .timestamps.json) is provided, uses word-level
 * extraction. Otherwise, falls back to inline timestamp markers in the
 * transcript markdown.
 *
 * @param transcript - The full transcript content (markdown)
 * @param fromTime - Start timestamp string (e.g., "1:30")
 * @param toTime - End timestamp string (e.g., "5:45")
 * @param file - Source file path for error reporting
 * @param timestamps - Optional word-level timestamps from .timestamps.json
 * @returns Extracted transcript with from/to as seconds, or error
 */
export function extractVideoExcerpt(
  transcript: string,
  fromTime: string,
  toTime: string,
  file: string,
  timestamps?: TimestampEntry[]
): VideoExcerptResult {
  // Parse the requested timestamps
  const fromSeconds = parseTimestamp(fromTime);
  if (fromSeconds === null) {
    return {
      error: {
        file,
        message: `Invalid timestamp format: '${fromTime}'`,
        suggestion: 'Valid formats: M:SS (e.g., 1:30), MM:SS (e.g., 01:30), H:MM:SS (e.g., 1:30:00), M:SS.ms (e.g., 1:30.50)',
        severity: 'error',
      },
    };
  }

  const toSeconds = parseTimestamp(toTime);
  if (toSeconds === null) {
    return {
      error: {
        file,
        message: `Invalid timestamp format: '${toTime}'`,
        suggestion: 'Valid formats: M:SS (e.g., 1:30), MM:SS (e.g., 01:30), H:MM:SS (e.g., 1:30:00), M:SS.ms (e.g., 1:30.50)',
        severity: 'error',
      },
    };
  }

  // Validate that from is not after to
  if (fromSeconds > toSeconds) {
    return {
      error: {
        file,
        message: `Start timestamp '${fromTime}' is after end timestamp '${toTime}'`,
        suggestion: 'Ensure the from:: timestamp comes before the to:: timestamp',
        severity: 'error',
      },
    };
  }

  // If timestamps data is provided, use word-level extraction
  if (timestamps && timestamps.length > 0) {
    const extractedText = extractFromTimestamps(timestamps, fromSeconds, toSeconds);
    return {
      from: fromSeconds,
      to: toSeconds,
      transcript: extractedText,
    };
  }

  // Fall back to inline timestamp markers in the markdown
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
  // Handle plain prose transcripts (no timestamps at all)
  if (timestampedLines.length === 0) {
    // If starting from 0:00, include entire transcript
    if (fromSeconds === 0) {
      return {
        from: fromSeconds,
        to: toSeconds,
        transcript: transcript.trim(),
      };
    }
    // Can't extract from a non-zero timestamp in a plain prose transcript
    return {
      error: {
        file,
        message: `Start timestamp '${fromTime}' not found in transcript (transcript has no timestamp markers)`,
        suggestion: 'This transcript has no timestamp markers. Use from:: 0:00 to include from the start, or add timestamps to the transcript.',
        severity: 'error',
      },
    };
  }

  // A line is included if its timestamp >= fromSeconds and < toSeconds
  // Special case: fromSeconds === 0 means "start of video" - no need to find exact 0:00 marker
  let foundFrom = fromSeconds === 0;
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
