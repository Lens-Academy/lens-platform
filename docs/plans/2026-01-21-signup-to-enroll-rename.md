# Signup to Enroll Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename "Sign Up" to "Enroll" throughout the UI to differentiate course enrollment from account sign-in.

**Architecture:** This is a straightforward rename affecting frontend routes, components, and UI text. The backend auth routes redirect to `/signup` on errors and need updating. The database table `signups` stays unchanged per user request.

**Tech Stack:** Vike (React), FastAPI, TypeScript

---

## Task 1: Rename the Frontend Route

**Files:**
- Rename: `web_frontend/src/pages/signup/` → `web_frontend/src/pages/enroll/`

**Step 1: Rename the directory**

```bash
mv web_frontend/src/pages/signup web_frontend/src/pages/enroll
```

**Step 2: Verify the route works**

Run: `cd web_frontend && npm run dev`
Navigate to: `http://localhost:3000/enroll`
Expected: The enrollment wizard loads correctly

**Step 3: Commit**

```bash
jj desc -m "feat: rename /signup route to /enroll"
```

---

## Task 2: Rename the View Component

**Files:**
- Rename: `web_frontend/src/views/Signup.tsx` → `web_frontend/src/views/Enroll.tsx`
- Modify: `web_frontend/src/pages/enroll/+Page.tsx`

**Step 1: Rename the view file**

```bash
mv web_frontend/src/views/Signup.tsx web_frontend/src/views/Enroll.tsx
```

**Step 2: Update the view component name**

In `web_frontend/src/views/Enroll.tsx`, change:

```tsx
export default function Signup() {
```

to:

```tsx
export default function Enroll() {
```

**Step 3: Update the page import**

In `web_frontend/src/pages/enroll/+Page.tsx`, change:

```tsx
import Layout from "@/components/Layout";
import Signup from "@/views/Signup";

export default function SignupPage() {
  return (
    <Layout>
      <Signup />
    </Layout>
  );
}
```

to:

```tsx
import Layout from "@/components/Layout";
import Enroll from "@/views/Enroll";

export default function EnrollPage() {
  return (
    <Layout>
      <Enroll />
    </Layout>
  );
}
```

**Step 4: Verify the page loads**

Run: `cd web_frontend && npm run dev`
Navigate to: `http://localhost:3000/enroll`
Expected: Page loads without errors

**Step 5: Commit**

```bash
jj desc -m "refactor: rename Signup view to Enroll"
```

---

## Task 3: Rename Signup Components Directory

**Files:**
- Rename: `web_frontend/src/components/signup/` → `web_frontend/src/components/enroll/`
- Modify: `web_frontend/src/views/Enroll.tsx` (update import)

**Step 1: Rename the components directory**

```bash
mv web_frontend/src/components/signup web_frontend/src/components/enroll
```

**Step 2: Update the import in Enroll.tsx**

In `web_frontend/src/views/Enroll.tsx`, change:

```tsx
import SignupWizard from "../components/signup/SignupWizard";
```

to:

```tsx
import EnrollWizard from "../components/enroll/EnrollWizard";
```

And update the JSX:

```tsx
<EnrollWizard />
```

**Step 3: Commit**

```bash
jj desc -m "refactor: rename signup components directory to enroll"
```

---

## Task 4: Rename SignupWizard Component

**Files:**
- Rename: `web_frontend/src/components/enroll/SignupWizard.tsx` → `web_frontend/src/components/enroll/EnrollWizard.tsx`
- Modify: The component itself

**Step 1: Rename the file**

```bash
mv web_frontend/src/components/enroll/SignupWizard.tsx web_frontend/src/components/enroll/EnrollWizard.tsx
```

**Step 2: Update the component name and internal references**

In `web_frontend/src/components/enroll/EnrollWizard.tsx`:

Change the function name:
```tsx
export default function SignupWizard() {
```
to:
```tsx
export default function EnrollWizard() {
```

**Step 3: Commit**

```bash
jj desc -m "refactor: rename SignupWizard to EnrollWizard"
```

---

## Task 5: Rename SuccessMessage Component

**Files:**
- Rename: `web_frontend/src/components/enroll/SuccessMessage.tsx` → `web_frontend/src/components/enroll/EnrollSuccessMessage.tsx`
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx` (update import)
- Modify: The component content

**Step 1: Rename the file**

```bash
mv web_frontend/src/components/enroll/SuccessMessage.tsx web_frontend/src/components/enroll/EnrollSuccessMessage.tsx
```

**Step 2: Update the import in EnrollWizard.tsx**

Change:
```tsx
import SuccessMessage from "./SuccessMessage";
```
to:
```tsx
import EnrollSuccessMessage from "./EnrollSuccessMessage";
```

And update the usage:
```tsx
return <SuccessMessage />;
```
to:
```tsx
return <EnrollSuccessMessage />;
```

**Step 3: Update the component name and content**

In `web_frontend/src/components/enroll/EnrollSuccessMessage.tsx`:

Change function name:
```tsx
export default function SuccessMessage() {
```
to:
```tsx
export default function EnrollSuccessMessage() {
```

Change the heading text (line 23-24):
```tsx
<h2 className="text-2xl font-bold text-gray-900 mb-2">
  You're Signed Up!
</h2>
```
to:
```tsx
<h2 className="text-2xl font-bold text-gray-900 mb-2">
  You're Enrolled!
</h2>
```

Change the paragraph text (line 26-28):
```tsx
<p className="text-gray-600 mb-8">
  Your registration has been submitted successfully. Now join our Discord
  server to connect with your cohort and get started.
</p>
```
to:
```tsx
<p className="text-gray-600 mb-8">
  Your enrollment has been submitted successfully. Now join our Discord
  server to connect with your cohort and get started.
</p>
```

**Step 4: Commit**

```bash
jj desc -m "refactor: rename SuccessMessage to EnrollSuccessMessage with updated text"
```

---

## Task 6: Update Landing Page Button and Text

**Files:**
- Modify: `web_frontend/src/pages/index/+Page.tsx`

**Step 1: Update the button href and text**

In `web_frontend/src/pages/index/+Page.tsx`:

Change lines 35-40:
```tsx
<a
  href="/signup"
  className="w-full sm:w-auto px-8 py-3.5 rounded-full border-2 border-slate-200 text-slate-700 font-semibold text-lg hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
>
  Sign Up
</a>
```
to:
```tsx
<a
  href="/enroll"
  className="w-full sm:w-auto px-8 py-3.5 rounded-full border-2 border-slate-200 text-slate-700 font-semibold text-lg hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
>
  Enroll
</a>
```

Change line 43:
```tsx
<p className="text-sm text-slate-500 mt-6">
  Try our intro module first, or sign up directly for the full course.
</p>
```
to:
```tsx
<p className="text-sm text-slate-500 mt-6">
  Try our intro module first, or enroll directly in the full course.
</p>
```

**Step 2: Verify the landing page**

Navigate to: `http://localhost:3000/`
Expected: Button says "Enroll" and links to `/enroll`

**Step 3: Commit**

```bash
jj desc -m "feat: update landing page button from Sign Up to Enroll"
```

---

## Task 7: Update ModuleCompleteModal CTA Text

**Files:**
- Modify: `web_frontend/src/components/module/ModuleCompleteModal.tsx`

**Step 1: Update all "Join the Full Course" links to /enroll**

In `web_frontend/src/components/module/ModuleCompleteModal.tsx`:

Change line 63:
```tsx
primaryCta = { label: "Join the Full Course", href: "/signup" };
```
to:
```tsx
primaryCta = { label: "Join the Full Course", href: "/enroll" };
```

Change line 75:
```tsx
primaryCta = { label: "Join the Full Course", href: "/signup" };
```
to:
```tsx
primaryCta = { label: "Join the Full Course", href: "/enroll" };
```

Change line 86:
```tsx
primaryCta = { label: "Join the Full Course", href: "/signup" };
```
to:
```tsx
primaryCta = { label: "Join the Full Course", href: "/enroll" };
```

**Step 2: Commit**

```bash
jj desc -m "feat: update ModuleCompleteModal CTAs to use /enroll route"
```

---

## Task 8: Update AvailabilityStep Final Button Text

**Files:**
- Modify: `web_frontend/src/components/enroll/AvailabilityStep.tsx`

**Step 1: Update the submit button text**

In `web_frontend/src/components/enroll/AvailabilityStep.tsx`:

Change lines 118-120:
```tsx
{totalSlots === 0
  ? "Select at least one time slot"
  : "Complete Signup"}
```
to:
```tsx
{totalSlots === 0
  ? "Select at least one time slot"
  : "Complete Enrollment"}
```

**Step 2: Commit**

```bash
jj desc -m "feat: update final button text to Complete Enrollment"
```

---

## Task 9: Update CohortRoleStep "No Cohorts Available" Text

**Files:**
- Modify: `web_frontend/src/components/enroll/CohortRoleStep.tsx`

**Step 1: Update the message**

In `web_frontend/src/components/enroll/CohortRoleStep.tsx`:

Change lines 113-114:
```tsx
<p className="text-gray-600 mb-6">
  No cohorts are currently available for signup.
</p>
```
to:
```tsx
<p className="text-gray-600 mb-6">
  No cohorts are currently available for enrollment.
</p>
```

**Step 2: Commit**

```bash
jj desc -m "feat: update no cohorts message text"
```

---

## Task 10: Update Backend Auth Error Redirects

**Files:**
- Modify: `web_api/routes/auth.py`

**Step 1: Update all /signup redirects to /enroll**

In `web_api/routes/auth.py`:

Change line 154:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/signup?error={error}")
```
to:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error={error}")
```

Change line 157:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/signup?error=missing_params")
```
to:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=missing_params")
```

Change line 162:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/signup?error=invalid_state")
```
to:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=invalid_state")
```

Change line 186:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/signup?error=token_exchange")
```
to:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=token_exchange")
```

Change line 198:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/signup?error=user_fetch")
```
to:
```python
return RedirectResponse(url=f"{FRONTEND_URL}/enroll?error=user_fetch")
```

Change line 242:
```python
return RedirectResponse(url=f"{redirect_base}/signup?error=missing_code")
```
to:
```python
return RedirectResponse(url=f"{redirect_base}/enroll?error=missing_code")
```

Change line 246:
```python
return RedirectResponse(url=f"{redirect_base}/signup?error={error}")
```
to:
```python
return RedirectResponse(url=f"{redirect_base}/enroll?error={error}")
```

**Step 2: Run backend lint check**

Run: `ruff check web_api/routes/auth.py`
Expected: No errors

**Step 3: Commit**

```bash
jj desc -m "feat: update auth error redirects from /signup to /enroll"
```

---

## Task 11: Rename Types File

**Files:**
- Rename: `web_frontend/src/types/signup.ts` → `web_frontend/src/types/enroll.ts`
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx`
- Modify: `web_frontend/src/components/enroll/CohortRoleStep.tsx`
- Modify: `web_frontend/src/components/enroll/AvailabilityStep.tsx`

**Step 1: Rename the types file**

```bash
mv web_frontend/src/types/signup.ts web_frontend/src/types/enroll.ts
```

**Step 2: Update imports in EnrollWizard.tsx**

Change:
```tsx
import type { SignupFormData, Cohort } from "../../types/signup";
import { EMPTY_AVAILABILITY, getBrowserTimezone } from "../../types/signup";
```
to:
```tsx
import type { EnrollFormData, Cohort } from "../../types/enroll";
import { EMPTY_AVAILABILITY, getBrowserTimezone } from "../../types/enroll";
```

**Step 3: Update imports in CohortRoleStep.tsx**

Change:
```tsx
import type { Cohort } from "../../types/signup";
```
to:
```tsx
import type { Cohort } from "../../types/enroll";
```

**Step 4: Update imports in AvailabilityStep.tsx**

Change:
```tsx
import type { AvailabilityData } from "../../types/signup";
import { COMMON_TIMEZONES, formatTimezoneDisplay } from "../../types/signup";
```
to:
```tsx
import type { AvailabilityData } from "../../types/enroll";
import { COMMON_TIMEZONES, formatTimezoneDisplay } from "../../types/enroll";
```

**Step 5: Commit**

```bash
jj desc -m "refactor: rename signup.ts types to enroll.ts"
```

---

## Task 12: Rename SignupFormData Type

**Files:**
- Modify: `web_frontend/src/types/enroll.ts`
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx`

**Step 1: Update the type name in enroll.ts**

In `web_frontend/src/types/enroll.ts`:

Change:
```tsx
export interface SignupFormData {
```
to:
```tsx
export interface EnrollFormData {
```

**Step 2: Update the type usage in EnrollWizard.tsx**

Change:
```tsx
const [formData, setFormData] = useState<SignupFormData>({
```
to:
```tsx
const [formData, setFormData] = useState<EnrollFormData>({
```

**Step 3: Commit**

```bash
jj desc -m "refactor: rename SignupFormData to EnrollFormData"
```

---

## Task 13: Update Analytics Events (Optional - Keep for backwards compatibility)

**Files:**
- Modify: `web_frontend/src/analytics.ts`
- Modify: `web_frontend/src/components/enroll/EnrollWizard.tsx`

**Note:** Analytics events should generally keep their names for historical consistency. However, since this is a relatively new codebase, we'll rename them for clarity.

**Step 1: Rename analytics functions in analytics.ts**

In `web_frontend/src/analytics.ts`:

Change lines 217-230:
```tsx
// Signup events
export function trackSignupStarted(): void {
  if (!shouldTrack()) return;
  posthog.capture("signup_started");
}

export function trackSignupStepCompleted(stepName: string): void {
  if (!shouldTrack()) return;
  posthog.capture("signup_step_completed", { step_name: stepName });
}

export function trackSignupCompleted(): void {
  if (!shouldTrack()) return;
  posthog.capture("signup_completed");
}
```
to:
```tsx
// Enrollment events
export function trackEnrollmentStarted(): void {
  if (!shouldTrack()) return;
  posthog.capture("enrollment_started");
}

export function trackEnrollmentStepCompleted(stepName: string): void {
  if (!shouldTrack()) return;
  posthog.capture("enrollment_step_completed", { step_name: stepName });
}

export function trackEnrollmentCompleted(): void {
  if (!shouldTrack()) return;
  posthog.capture("enrollment_completed");
}
```

**Step 2: Update imports and usage in EnrollWizard.tsx**

Change:
```tsx
import {
  trackSignupStarted,
  trackSignupStepCompleted,
  trackSignupCompleted,
} from "../../analytics";
```
to:
```tsx
import {
  trackEnrollmentStarted,
  trackEnrollmentStepCompleted,
  trackEnrollmentCompleted,
} from "../../analytics";
```

Update the calls:
- `trackSignupStarted()` → `trackEnrollmentStarted()`
- `trackSignupStepCompleted(...)` → `trackEnrollmentStepCompleted(...)`
- `trackSignupCompleted()` → `trackEnrollmentCompleted()`

**Step 3: Commit**

```bash
jj desc -m "refactor: rename signup analytics events to enrollment"
```

---

## Task 14: Run Full Lint and Build Check

**Step 1: Run frontend lint**

```bash
cd web_frontend && npm run lint
```
Expected: No errors

**Step 2: Run frontend build**

```bash
cd web_frontend && npm run build
```
Expected: Build succeeds

**Step 3: Run backend lint**

```bash
ruff check .
```
Expected: No errors

**Step 4: Fix any issues found**

If there are errors, fix them before proceeding.

**Step 5: Commit any fixes**

```bash
jj desc -m "fix: address lint errors from rename"
```

---

## Task 15: Final Manual Testing

**Step 1: Start the dev servers**

```bash
python main.py --dev
# In another terminal:
cd web_frontend && npm run dev
```

**Step 2: Test the enrollment flow**

1. Navigate to `http://localhost:3000/`
2. Verify "Enroll" button is visible
3. Click "Enroll" - should go to `/enroll`
4. Complete the enrollment wizard
5. Verify final button says "Complete Enrollment"
6. Verify success message says "You're Enrolled!"

**Step 3: Test auth error redirects**

1. Navigate to `http://localhost:8000/auth/discord?next=/course`
2. If not configured, verify redirect goes to `/enroll?error=...`

**Step 4: Test module completion modal**

1. Complete a module as a non-enrolled user
2. Verify CTA links to `/enroll`

---

## Summary of Changes

| Old | New |
|-----|-----|
| `/signup` route | `/enroll` route |
| `Signup.tsx` view | `Enroll.tsx` view |
| `components/signup/` | `components/enroll/` |
| `SignupWizard` | `EnrollWizard` |
| `SuccessMessage` | `EnrollSuccessMessage` |
| "Sign Up" button | "Enroll" button |
| "Complete Signup" | "Complete Enrollment" |
| "You're Signed Up!" | "You're Enrolled!" |
| `types/signup.ts` | `types/enroll.ts` |
| `SignupFormData` | `EnrollFormData` |
| `trackSignupStarted` | `trackEnrollmentStarted` |

**Not changed:**
- Database `signups` table (per user request)
- Backend API endpoints (no signup-named endpoints)
- "Sign in" button (this is for account login, not course enrollment)
