# Feedback Button Design

## Overview

A floating feedback button that opens a Google Form in a new tab, with pre-filled user info when logged in.

## Goals

- Collect freeform feedback from users
- Minimal implementation effort (Google Forms handles storage/notifications)
- Nice in-app UX (branded button) without building custom forms
- Easy to swap backend later (just change the URL)

## Frontend Component

**File:** `web_frontend/src/components/FeedbackButton.tsx`

**Visual design:**
- Floating button, fixed position bottom-left
- Purple gradient background with hover effect
- "Feedback" label with message icon (lucide-react)
- Small "ALPHA" badge overlaid on top-right corner of button

**Props:**
- `userEmail?: string` - Pre-fill email field if user is logged in

**Behavior:**
- Click opens Google Form in new tab
- Constructs URL with pre-fill parameters for email
- No mobile-specific handling (mobile not supported)

**Placement:**
- Imported in main app layout (appears on all pages)
- High z-index to float above content

## Google Form Structure

**Fields:**

1. **Message** (long text, required)
   - Placeholder: "Tell us what's on your mind..."

2. **Email** (short text, optional)
   - Pre-filled for logged-in users
   - Help text: "Optional - but we can't follow up without it"

**Settings:**
- Collect email addresses: OFF
- Limit to 1 response: OFF
- Confirmation message: "Thanks! We read every piece of feedback."

## Pre-fill URL Format

```
https://docs.google.com/forms/d/e/1FAIpQLSfcSdjQqNn6L-6bHAHJCVcKkSdRoEe4D47euBcrKkMlhHHIQA/viewform?entry.793821915=user@email.com
```

Entry IDs:
- Email field: `entry.793821915`
- Feedback field: `entry.1250599795` (not pre-filled)

## Future Considerations

- Can swap Google Form URL for UserJot/Sleekplan later without frontend changes
- Could add inline thumbs up/down for AI tutor responses separately
- Could add category dropdown later if needed to triage feedback types
