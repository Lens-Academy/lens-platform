/**
 * Duration formatting and computation for reading time estimates.
 * Uses minutes as the base unit (unlike formatDuration.ts which uses seconds for video playback).
 */

/** Format a duration in minutes as human-readable string. */
export function formatDurationMinutes(minutes: number): string {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  return `${minutes} min`;
}

/** Compute estimated reading/viewing duration for a section in minutes. */
export function computeSectionDuration(section: {
  wordCount?: number;
  videoDurationSeconds?: number;
}): number {
  const words = section.wordCount ?? 0;
  const videoSeconds = section.videoDurationSeconds ?? 0;
  return Math.round((words / 200 + videoSeconds / 60) * 1.5);
}

/** Break down total duration into content time and AI tutor time. */
export function computeDurationBreakdown(section: {
  wordCount?: number;
  videoDurationSeconds?: number;
}): { total: number; contentTime: number; aiTime: number; hasVideo: boolean } {
  const words = section.wordCount ?? 0;
  const videoSeconds = section.videoDurationSeconds ?? 0;
  const contentTime = Math.round(words / 200 + videoSeconds / 60);
  const total = Math.round(contentTime * 1.5);
  const aiTime = total - contentTime;
  const hasVideo = videoSeconds > 0;
  return { total, contentTime, aiTime, hasVideo };
}
