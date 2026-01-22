# Phase 4: Chat Interface - Research

**Researched:** 2026-01-22
**Domain:** Mobile chat interface - iOS Safari keyboard handling, touch targets, message styling
**Confidence:** HIGH

## Summary

This phase adapts the existing NarrativeChatSection component for mobile. The key challenges are:

1. **iOS Safari keyboard handling** - Safari pushes the viewport up rather than resizing it, which can hide fixed-position inputs
2. **Chat container height** - Currently uses `85vh` which doesn't adapt to iOS Safari's dynamic address bar
3. **Touch targets** - Send and microphone buttons need 44px minimum touch targets
4. **Message styling** - Already has differentiated colors (blue-50 for AI, gray-100 for user), needs spacing/typography review

The codebase already has foundational patterns from Phase 1-3: dvh units, safe-area CSS variables, 44px touch targets on StageProgressBar, and haptic feedback utility. This phase extends those patterns to the chat interface.

**Primary recommendation:** Use `scrollIntoView` on input focus instead of `position: fixed` input bar. iOS Safari's viewport push behavior works well with this approach - the chat container scrolls to keep input visible. Avoid fighting Safari's native behavior.

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19 | Component framework | Already in use |
| Tailwind CSS | v4 | Styling with dvh support | Built-in mobile utilities |

### Supporting (No New Dependencies Needed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @/utils/haptics | local | Haptic feedback | triggerHaptic(10) on send |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| scrollIntoView | visualViewport API | visualViewport has iOS bugs; scrollIntoView is simpler and reliable |
| Native scroll behavior | position: fixed input | Fixed positioning breaks on iOS Safari keyboard |
| Manual keyboard detection | focus/blur events | Focus events are more reliable than viewport resize on iOS |

**Installation:**
```bash
# No installation needed - all required utilities already present
```

## Architecture Patterns

### Current NarrativeChatSection Structure

The component is well-structured with clear separation:

```
NarrativeChatSection.tsx (793 lines)
├── ChatMarkdown          # Inline markdown rendering
├── State management      # input, recording, scroll tracking
├── Recording logic       # MediaRecorder, transcription
├── UI layout
│   ├── Messages area     # scrollContainerRef, overflow-y-auto
│   ├── Previous messages # currentExchangeStartIndex split
│   ├── Current exchange  # minHeight for scroll positioning
│   ├── Scroll button     # absolute positioned
│   └── Input form        # textarea + buttons
```

### Pattern 1: Keyboard-Aware Scroll (Recommended)

**What:** Use `scrollIntoView` when input focuses, let Safari's viewport push handle the rest
**When to use:** Chat interfaces on iOS Safari
**Why:** Safari pushes viewport up when keyboard opens - work with this behavior, don't fight it

```typescript
// On input focus, scroll the input into view
const handleInputFocus = useCallback(() => {
  // Small delay to let keyboard animation start
  setTimeout(() => {
    textareaRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end'  // Keep input at bottom of visible area
    });
  }, 100);
}, []);
```

### Pattern 2: Visual Viewport Fallback (For Fixed Elements)

**What:** Use visualViewport API to position fixed elements above keyboard
**When to use:** Only if scrollIntoView approach doesn't work for the design
**Why:** Provides keyboard height information, but has iOS quirks

```typescript
// Only use if absolutely need fixed positioning
useEffect(() => {
  if (!window.visualViewport) return;

  const handleResize = () => {
    const viewport = window.visualViewport!;
    const keyboardHeight = window.innerHeight - viewport.height;
    // Adjust fixed element position
    inputRef.current?.style.setProperty(
      'transform',
      `translateY(-${keyboardHeight}px)`
    );
  };

  window.visualViewport.addEventListener('resize', handleResize);
  return () => window.visualViewport?.removeEventListener('resize', handleResize);
}, []);
```

**WARNING:** visualViewport API has known iOS Safari bugs - resize events can be inconsistent, especially with fast typing or orientation changes.

### Pattern 3: Focus-Based Keyboard Detection

**What:** Detect keyboard open state via focus events, not viewport size
**When to use:** When you need to know if keyboard is open for UI changes
**Why:** More reliable than viewport resize on iOS

```typescript
const useIsKeyboardOpen = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const isKeyboardInput = (elem: HTMLElement) =>
      (elem.tagName === 'INPUT' &&
        !['button', 'submit', 'checkbox', 'file', 'image'].includes(
          (elem as HTMLInputElement).type
        )) ||
      elem.tagName === 'TEXTAREA' ||
      elem.hasAttribute('contenteditable');

    const handleFocusIn = (e: FocusEvent) => {
      if (e.target && isKeyboardInput(e.target as HTMLElement)) {
        setIsOpen(true);
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      if (e.target && isKeyboardInput(e.target as HTMLElement)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  return isOpen;
};
```

### Anti-Patterns to Avoid

- **`position: fixed; bottom: 0` for input bar on iOS:** Gets hidden behind keyboard or jumps around
- **Relying solely on visualViewport resize:** Events can be inconsistent on iOS Safari
- **Using `100vh` for chat container:** Use `dvh` units for iOS Safari address bar compatibility
- **Fighting Safari's viewport push:** Work with the native behavior, not against it

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Keyboard detection | Viewport size monitoring | Focus/blur events | iOS doesn't reliably resize viewport |
| Haptic feedback | Custom vibration logic | `triggerHaptic()` from utils | Already implemented with fallbacks |
| Touch target sizing | Pixel calculations | `min-w-[44px] min-h-[44px]` | Tailwind pattern from StageProgressBar |
| Dynamic viewport height | JS resize listeners | `h-[85dvh]` | CSS native, performant |

**Key insight:** iOS Safari's keyboard behavior is intentional - it pushes content up to keep the focused input visible. The simplest solution is to ensure the chat container scrolls properly and the input stays in view.

## Common Pitfalls

### Pitfall 1: Using vh Instead of dvh for Chat Container
**What goes wrong:** Chat content hidden behind iOS Safari address bar when visible
**Why it happens:** Current code uses `height: "85vh"` inline style
**How to avoid:** Replace with `85dvh` - codebase already uses dvh elsewhere
**Warning signs:** Content cut off at bottom when Safari address bar is showing

### Pitfall 2: Fixed Position Input on iOS Safari
**What goes wrong:** Input disappears behind keyboard or jumps unpredictably
**Why it happens:** iOS Safari doesn't resize the Layout Viewport when keyboard opens
**How to avoid:** Use scrollIntoView approach, or if fixed is required, use visualViewport API with fallbacks
**Warning signs:** Input hidden when keyboard opens, input position jumps around

### Pitfall 3: Small Touch Targets on Buttons
**What goes wrong:** Users miss taps on send/microphone buttons
**Why it happens:** Buttons sized for visual appearance, not touch interaction
**How to avoid:** Ensure `min-w-[44px] min-h-[44px]` on all interactive elements
**Warning signs:** User complaints about needing multiple taps, analytics showing low success rate

### Pitfall 4: Font Size Under 16px on Input
**What goes wrong:** iOS Safari auto-zooms when user taps input
**Why it happens:** iOS zooms to make text readable when font-size < 16px
**How to avoid:** Current textarea already uses base font size (18px body), should be fine
**Warning signs:** Unexpected page zoom when focusing the chat input

### Pitfall 5: No Haptic Feedback Consistency
**What goes wrong:** Send button feels different from other touch interactions
**Why it happens:** Forgot to add `triggerHaptic()` on send
**How to avoid:** Add `triggerHaptic(10)` in handleSubmit, matching Phase 3 pattern
**Warning signs:** Inconsistent tactile feedback across app

### Pitfall 6: Timestamp Always Visible
**What goes wrong:** Visual clutter, wasted vertical space on mobile
**Why it happens:** Showing timestamps on every message
**How to avoid:** Per CONTEXT.md, show timestamps on tap/hover only
**Warning signs:** Messages feel cramped, too much non-content UI

## Code Examples

### Current Chat Container (Needs Update)
Source: NarrativeChatSection.tsx line 441-445

```typescript
// CURRENT - uses vh which doesn't adapt to iOS Safari
style={
  hasInteracted
    ? { height: "85vh", overflowAnchor: "none" }
    : { maxHeight: "85vh", minHeight: "180px", overflowAnchor: "none" }
}

// RECOMMENDED - use dvh for iOS Safari compatibility
style={
  hasInteracted
    ? { height: "85dvh", overflowAnchor: "none" }
    : { maxHeight: "85dvh", minHeight: "180px", overflowAnchor: "none" }
}
```

### Touch Target Pattern (From StageProgressBar)
Source: StageProgressBar.tsx line 119, 175, 205

```typescript
// Pattern for 44px touch targets - already in codebase
<button className="min-w-[44px] min-h-[44px] p-2 rounded ...">

// Apply to send button (currently px-4 py-2 which may be too small)
<button
  type="submit"
  className="min-w-[44px] min-h-[44px] bg-blue-600 text-white px-4 py-2 rounded-lg ..."
>
  Send
</button>

// Apply to microphone button (currently p-2 which is ~36px)
<button
  type="button"
  onClick={handleMicClick}
  className="min-w-[44px] min-h-[44px] p-2 rounded-lg ..."
>
```

### Haptic on Send (Pattern from StageProgressBar)
Source: StageProgressBar.tsx line 96, haptics.ts

```typescript
import { triggerHaptic } from "@/utils/haptics";

const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  if (input.trim() && !isLoading) {
    triggerHaptic(10); // Add haptic feedback on send
    // ... rest of submit logic
  }
};
```

### ScrollIntoView on Focus
Source: Research synthesis

```typescript
// Add to textarea
<textarea
  ref={textareaRef}
  onFocus={() => {
    // Delay to let keyboard start animating
    setTimeout(() => {
      textareaRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }, 100);
  }}
  // ... rest of props
/>
```

### Message Styling (Already Implemented)
Source: NarrativeChatSection.tsx line 470-473, 520-523

```typescript
// Current implementation already differentiates user vs AI
// AI messages: bg-blue-50 text-gray-800
// User messages: bg-gray-100 text-gray-800 ml-8

// This matches CONTEXT.md decision for different colors
// May want to add more padding/spacing for mobile readability
<div className={`p-3 rounded-lg ${
  msg.role === "assistant"
    ? "bg-blue-50 text-gray-800"
    : "bg-gray-100 text-gray-800 ml-8"
}`}>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `position: fixed; bottom: 0` | scrollIntoView + native scroll | Always problematic on iOS | Avoids iOS keyboard fighting |
| window.innerHeight checks | visualViewport API | Safari 13+ (2019) | Accurate keyboard detection |
| vh for containers | dvh (dynamic viewport height) | Safari 15.4+ (2022) | Address bar awareness |
| Custom keyboard listeners | Focus/blur events | Best practice | More reliable on iOS |

**Deprecated/outdated:**
- **VirtualKeyboard API (navigator.virtualKeyboard):** Not supported in Safari - Chromium only
- **`interactive-widget=resizes-content`:** Chrome 108+ only, not Safari
- **Viewport resize for keyboard detection:** Unreliable on iOS Safari

## Open Questions

1. **Input bar docking behavior**
   - What we know: CONTEXT.md says "Claude's discretion" for docking position
   - Options: Fixed bottom vs. below messages (natural scroll)
   - Recommendation: Start with natural scroll (current behavior) + scrollIntoView on focus. Avoids iOS fixed position issues entirely.

2. **Auto-scroll on new messages**
   - What we know: Current implementation has scroll-to-bottom button
   - What's unclear: Should it auto-scroll when streaming or only when user is near bottom?
   - Recommendation: Auto-scroll only if user is within ~50px of bottom (current implementation does this)

3. **Tap-outside-to-dismiss-keyboard**
   - What we know: CONTEXT.md says "Claude's discretion"
   - Options: Blur input on tap outside vs. native behavior
   - Recommendation: Use native behavior (iOS handles this). Adding custom blur can conflict with button taps.

## Sources

### Primary (HIGH confidence)
- NarrativeChatSection.tsx - Current implementation analyzed (793 lines)
- StageProgressBar.tsx - 44px touch target pattern verified
- haptics.ts - triggerHaptic implementation
- globals.css - Safe area CSS variables, typography scale

### Secondary (MEDIUM confidence)
- Martijn Hols blog (martijnhols.nl) - iOS Safari keyboard detection via focus events
- Bram.us - VirtualKeyboard API overview (confirmed Safari doesn't support it)
- Apple Human Interface Guidelines - 44pt (44px) minimum touch targets

### Tertiary (LOW confidence)
- Stack Overflow discussions - iOS Safari keyboard workarounds
- GitHub issues (Mastodon, Hydrogen) - Real-world iOS keyboard problems

## Metadata

**Confidence breakdown:**
- iOS keyboard handling: HIGH - Multiple sources confirm scrollIntoView approach works better than fixed positioning on iOS
- Touch targets: HIGH - 44px pattern already proven in codebase (StageProgressBar)
- Haptics: HIGH - triggerHaptic utility already implemented and tested
- Message styling: HIGH - Current implementation already differentiates roles
- dvh migration: HIGH - Pattern already used throughout codebase

**Research date:** 2026-01-22
**Valid until:** 2026-04-22 (90 days - iOS Safari behavior is stable, patterns well-established)
