# YouTube VPN/Bot Detection Warning

## Problem

When users have a VPN enabled, YouTube embeds show a "Sign in to confirm you're not a bot" overlay instead of playing the video. The YouTube IFrame API does not expose this error - the `onError` event doesn't fire for this case.

Our system may incorrectly think the video is playing when it's actually stuck on this verification screen.

## Solution

Detect when the video claims to be playing but `currentTime` isn't advancing, then show a subtle warning suggesting VPN might be the cause.

## Implementation Plan

### 1. Add State for Warning

In `VideoPlayer.tsx`, add new state:

```typescript
const [showPlaybackWarning, setShowPlaybackWarning] = useState(false);
const playCheckTimeoutRef = useRef<number | null>(null);
```

### 2. Modify Play Event Handler

Update the `handlePlay` function to start a playback verification check:

```typescript
const handlePlay = () => {
  setIsPaused(false);
  setShowPlaybackWarning(false); // Reset on new play attempt
  onPlayCallback?.();

  // Clear any existing check
  if (playCheckTimeoutRef.current) {
    clearTimeout(playCheckTimeoutRef.current);
  }

  // Check if video is actually playing after 3 seconds
  const startTime = video.currentTime;
  playCheckTimeoutRef.current = window.setTimeout(() => {
    if (videoRef.current && !videoRef.current.paused) {
      const currentTime = videoRef.current.currentTime;
      // If time hasn't advanced by at least 0.5 seconds, something's wrong
      if (Math.abs(currentTime - startTime) < 0.5) {
        setShowPlaybackWarning(true);
      }
    }
  }, 3000);
};
```

### 3. Clear Timeout on Pause/Unmount

```typescript
const handlePause = () => {
  setIsPaused(true);
  onPauseCallback?.();
  // Clear playback check - user paused intentionally
  if (playCheckTimeoutRef.current) {
    clearTimeout(playCheckTimeoutRef.current);
  }
};

// In cleanup effect
return () => {
  // ... existing cleanup
  if (playCheckTimeoutRef.current) {
    clearTimeout(playCheckTimeoutRef.current);
  }
};
```

### 4. Clear Warning When Video Actually Starts Playing

In the existing polling `useEffect`, add a check to clear the warning once video starts advancing:

```typescript
// Inside the pollInterval callback, after progress update:
if (showPlaybackWarning && currentTime > start + 0.5) {
  setShowPlaybackWarning(false);
}
```

### 5. Add Warning UI

Add a small, unobtrusive warning banner above the video container:

```tsx
{/* Playback warning - shown when video appears stuck */}
{showPlaybackWarning && (
  <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-center gap-2">
    <span>Video not playing?</span>
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault();
        // Could open a modal or expand inline
        setShowPlaybackHelp(true);
      }}
      className="text-amber-600 hover:text-amber-800 underline"
    >
      VPNs can cause this issue
    </a>
    <button
      onClick={() => setShowPlaybackWarning(false)}
      className="ml-auto text-amber-400 hover:text-amber-600"
      aria-label="Dismiss"
    >
      ×
    </button>
  </div>
)}
```

### 6. Optional: Help Modal/Tooltip

Could add an expandable help section or modal with more details:

```
Having trouble playing videos?

YouTube may block video playback if you're using:
• A VPN or proxy service
• Certain browser privacy extensions
• A corporate network with strict firewalls

Try disabling your VPN temporarily, or sign in to YouTube in another tab.
```

## File Changes

| File | Change |
|------|--------|
| `web_frontend/src/components/unified-lesson/VideoPlayer.tsx` | Add detection logic and warning UI |

## Edge Cases to Handle

1. **Buffering on slow connections**: 3 seconds should be enough to distinguish from normal buffering, but could increase to 5 seconds to be safe
2. **User pauses immediately**: Clear the timeout on pause to avoid false positives
3. **Video actually starts after warning shown**: Clear warning when `currentTime` advances
4. **Multiple play/pause cycles**: Reset state appropriately on each play attempt

## Testing

1. Enable VPN, try to play video → warning should appear after 3 seconds
2. Disable VPN, play video normally → no warning
3. Slow connection with buffering → warning should NOT appear (video eventually plays)
4. Click play, immediately pause → no warning
5. Warning appears, then video starts playing (e.g., user signs into YouTube) → warning disappears

## Future Enhancements

- Track how often this warning is shown (analytics)
- Remember if user dismissed the warning and don't show it again for that session
- Detect other playback issues (video unavailable, embedding disabled)
