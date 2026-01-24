/**
 * Trigger haptic feedback on supported devices.
 * Falls back silently on unsupported browsers (iOS Safari, desktop).
 *
 * @param pattern - Vibration duration in ms or pattern array [vibrate, pause, vibrate, ...]
 */
export function triggerHaptic(pattern: number | number[] = 10): void {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Silently fail - haptic is enhancement only
    }
  }
}
