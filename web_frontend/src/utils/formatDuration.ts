// web_frontend_next/src/utils/formatDuration.ts

/**
 * Format seconds as human-readable duration.
 *
 * Under 5 minutes: shows seconds (e.g., "2 min 15 sec")
 * 5 minutes or above: rounds to whole minutes (e.g., "7 min")
 *
 * Examples:
 *   45 → "45 sec"
 *   135 → "2 min 15 sec"
 *   299 → "4 min 59 sec"
 *   300 → "5 min"
 *   423 → "7 min"
 *   3665 → "1 hr 1 min"
 */
export function formatDuration(seconds: number): string {
  // Guard against invalid input
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0 sec";
  }

  const totalSeconds = Math.floor(seconds);

  // Under 1 minute: show seconds only
  if (totalSeconds < 60) {
    return `${totalSeconds} sec`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  // 1 hour or more
  if (hours > 0) {
    if (minutes > 0) {
      return `${hours} hr ${minutes} min`;
    }
    return `${hours} hr`;
  }

  // 5 minutes or above: round to whole minutes
  if (totalSeconds >= 300) {
    const roundedMinutes = Math.round(totalSeconds / 60);
    return `${roundedMinutes} min`;
  }

  // Under 5 minutes: show minutes and seconds
  if (secs > 0) {
    return `${minutes} min ${secs} sec`;
  }
  return `${minutes} min`;
}
