# Next.js Migration to Vercel (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the React frontend to Next.js with SSR, deploy to Vercel, while keeping FastAPI on Railway as the API backend.

**Architecture:**
```
Vercel                          Railway
├── Next.js (lensacademy.org)    ├── FastAPI (api.lensacademy.org)
│   ├── / (SSR)                 │   ├── /api/*
│   ├── /course (SSR)           │   ├── /auth/*
│   ├── /lesson/* (CSR)         │   └── Discord bot
│   └── /signup (CSR)           │
└── Calls API via fetch         └── Sets cookies on .lensacademy.org
```

**Tech Stack:** Next.js 15 (App Router), React 19, Tailwind CSS 4, Vercel

---

## Key Architecture Decisions

### 1. Cookie Sharing Between Domains

For auth to work across Vercel (lensacademy.org) and Railway (api.lensacademy.org):
- FastAPI sets cookie with `domain=".lensacademy.org"`
- Cookie is sent to both domains
- Next.js forwards cookie to API in SSR requests

### 2. SSR vs CSR Pages

| Page | Rendering | Why |
|------|-----------|-----|
| `/` (landing) | SSR | SEO, social previews |
| `/course` | SSR | SEO, shows course structure |
| `/lesson/*` | CSR | Highly interactive, real-time chat |
| `/signup` | CSR | Form, no SEO needed |
| `/availability` | CSR | Form, no SEO needed |
| `/facilitator` | CSR | Admin page, no SEO needed |
| `/auth/*` | Redirect to API | OAuth flow stays on FastAPI |

### 3. API Calls

- **SSR (server components):** Call FastAPI directly with forwarded cookies
- **CSR (client components):** Call FastAPI via browser fetch with credentials

---

## Reference: Environment Variable Mapping

All `import.meta.env` references must be converted:

| Vite (old) | Next.js (new) |
|------------|---------------|
| `import.meta.env.VITE_API_URL` | `process.env.NEXT_PUBLIC_API_URL` |
| `import.meta.env.VITE_POSTHOG_KEY` | `process.env.NEXT_PUBLIC_POSTHOG_KEY` |
| `import.meta.env.VITE_POSTHOG_HOST` | `process.env.NEXT_PUBLIC_POSTHOG_HOST` |
| `import.meta.env.VITE_SENTRY_DSN` | `process.env.NEXT_PUBLIC_SENTRY_DSN` |
| `import.meta.env.VITE_APP_VERSION` | `process.env.NEXT_PUBLIC_APP_VERSION` |
| `import.meta.env.VITE_ENV_LABEL` | `process.env.NEXT_PUBLIC_ENV_LABEL` |
| `import.meta.env.PROD` | `process.env.NODE_ENV === 'production'` |
| `import.meta.env.MODE` | `process.env.NODE_ENV` |

---

## Reference: React Router → Next.js Hook Mapping

| React Router | Next.js | Notes |
|--------------|---------|-------|
| `useParams()` | `useParams()` from `next/navigation` | Returns `Record<string, string \| string[]>` |
| `useNavigate()` | `useRouter()` from `next/navigation` | Use `.push()` or `.replace()` |
| `useLocation()` | `usePathname()` + `useSearchParams()` | Split into two hooks |
| `useSearchParams()` | `useSearchParams()` from `next/navigation` | Returns `ReadonlyURLSearchParams`; **requires `<Suspense>` wrapper** |
| `<Link to="...">` | `<Link href="...">` | Different prop name; use `<a>` for external redirects |
| `<Outlet />` | `{children}` in layout.tsx | Layout pattern replaces Outlet |

**Important:** Pages using `useSearchParams()` must be wrapped in `<Suspense>` to avoid hydration errors in Next.js 15.

---

## Reference: Files Requiring Adaptation

These files contain `import.meta.env` or React Router imports and MUST be adapted:

| File | Contains |
|------|----------|
| `src/config.ts` | `import.meta.env.VITE_API_URL` - **many files import from this** |
| `src/analytics.ts` | `import.meta.env.VITE_POSTHOG_*` |
| `src/errorTracking.ts` | `import.meta.env.VITE_SENTRY_DSN` |
| `src/api/lessons.ts` | `API_BASE` needs `NEXT_PUBLIC_API_URL` |
| `src/hooks/useAuth.ts` | Imports from `config.ts` |
| `src/hooks/useAnonymousSession.ts` | May have env vars |
| `src/components/Layout.tsx` | `<Link to=...>`, `<Outlet />` |
| `src/components/unified-lesson/LessonCompleteModal.tsx` | `<Link to=...>` from react-router-dom |
| All page files in `src/pages/` | React Router hooks |

---

## Migration Strategy: Copy Everything, Adapt Minimally

**Key insight from v1 failure:** Reimplementing components from descriptions loses subtle features (like client-side article caching). Instead:

1. **Copy everything** from `web_frontend/src/` into the Next.js project
2. **Delete** framework-specific files that don't apply (Vite config, React Router)
3. **Recreate** Next.js infrastructure (App Router, layouts)
4. **Adapt** pages with MINIMAL changes - only what's required for Next.js

**Allowed changes per file:**
- Add `"use client"` directive at top
- Update import sources (React Router → Next.js)
- Replace `import.meta.env.*` with `process.env.NEXT_PUBLIC_*`
- Replace `<Link to=...>` with `<Link href=...>`
- **NOTHING ELSE** unless absolutely required

**After each adaptation:**
1. Run `git diff` to verify only expected changes were made
2. Run `npm run build` to verify TypeScript compiles

**Automated verification (run periodically):**
```bash
# Should return 0 results after migration is complete
grep -r "import.meta.env" web_frontend_next/src/
grep -r "react-router-dom" web_frontend_next/src/
grep -r '<Link to=' web_frontend_next/src/
```

---

## Task 1: Create Next.js Project Structure

**Files:**
- Create: `web_frontend_next/` (fresh Next.js project)

**Step 1: Create Next.js app**

```bash
cd /home/penguin/code-in-WSL/ai-safety-course-platform-ws2
npx create-next-app@latest web_frontend_next --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
```

When prompted:
- Would you like to use Turbopack? → Yes
- Would you like to customize the default import alias? → No

**Step 2: Install dependencies matching current frontend**

```bash
cd web_frontend_next
npm install lucide-react react-markdown rehype-raw remark-gfm
npm install @floating-ui/react
npm install posthog-js
```

**Step 3: Verify it runs**

```bash
npm run dev
```

Visit http://localhost:3000 - should see Next.js welcome page.

**Step 4: Verify import alias configuration**

```bash
cat tsconfig.json | grep -A5 '"paths"'
```

Should show `"@/*": ["./src/*"]`.

**Step 5: Commit**

```bash
jj new -m "feat: initialize Next.js project"
```

---

## Task 2: Copy All Source Files from Old Frontend

**Strategy:** Copy everything first, we'll delete what we don't need later.

**Step 1: Copy entire src directory**

```bash
cp -r web_frontend/src/* web_frontend_next/src/
```

**Step 2: Copy public assets**

```bash
cp -r web_frontend/public/* web_frontend_next/public/
```

**Step 3: Commit**

```bash
jj new -m "chore: copy all source files from Vite frontend"
```

> **Note:** The project will NOT compile after this step. This is expected. Many files contain Vite-specific imports (`import.meta.env`) and React Router imports that will be fixed in subsequent tasks.

---

## Task 3: Delete Vite-Specific Files

**Step 1: Remove Vite entry points**

```bash
rm web_frontend_next/src/App.tsx
rm web_frontend_next/src/main.tsx
rm web_frontend_next/src/vite-env.d.ts
```

**Step 2: Commit**

```bash
jj new -m "chore: remove Vite-specific files"
```

> **Note:** The project still won't compile. This is expected.

---

## Task 4: Configure Tailwind for Next.js

**Files:**
- Modify: `web_frontend_next/tailwind.config.ts`
- Modify: `web_frontend_next/src/app/globals.css`

**Step 1: Update Tailwind config**

Replace `web_frontend_next/tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [typography],
};

export default config;
```

**Step 2: Install typography plugin**

```bash
npm install @tailwindcss/typography
```

**Step 3: Update globals.css**

Copy relevant styles from `web_frontend/src/index.css` to `web_frontend_next/src/app/globals.css`. Convert Tailwind v4 syntax if needed:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-stone-50 text-slate-900 antialiased;
}
```

**Step 4: Commit**

```bash
jj new -m "feat: configure Tailwind CSS for Next.js"
```

---

## Task 5: Create Environment Configuration

**Files:**
- Create: `web_frontend_next/.env.local`
- Create: `web_frontend_next/.env.example`

**Step 1: Create environment files**

Create `web_frontend_next/.env.example`:

```bash
# API URL for the FastAPI backend (exposed to browser)
NEXT_PUBLIC_API_URL=http://localhost:8000

# Internal API URL (for server-side requests)
API_URL=http://localhost:8000

# Analytics (optional for dev)
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=
NEXT_PUBLIC_SENTRY_DSN=

# App metadata
NEXT_PUBLIC_APP_VERSION=dev
NEXT_PUBLIC_ENV_LABEL=development
```

Create `web_frontend_next/.env.local` with actual values.

**Step 2: Commit**

```bash
jj new -m "feat: add environment configuration"
```

---

## Task 6: Adapt Core Config and API Files

**This task must be done before adapting any pages, as many files import from these.**

**Files:**
- Adapt: `web_frontend_next/src/config.ts`
- Create: `web_frontend_next/src/lib/api-server.ts` (for SSR)
- Adapt: `web_frontend_next/src/lib/api.ts` (for CSR)
- Adapt: `web_frontend_next/src/api/lessons.ts`

**Step 1: Adapt config.ts**

```typescript
// OLD
export const API_URL = import.meta.env.VITE_API_URL ?? "";
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";

// NEW
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
```

**Step 2: Create server-side API client**

Create `web_frontend_next/src/lib/api-server.ts`:

```typescript
import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Fetch from API with session cookie forwarded (for SSR).
 * Use this in Server Components only.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  const headers: HeadersInit = {
    ...options.headers,
  };

  if (sessionCookie) {
    headers["Cookie"] = `session=${sessionCookie.value}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store", // Don't cache authenticated requests
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get current user from API (for SSR).
 * Returns null if not authenticated.
 */
export async function getCurrentUser() {
  try {
    const data = await apiFetch<{ authenticated: boolean; [key: string]: unknown }>("/auth/me");
    return data.authenticated ? data : null;
  } catch {
    return null;
  }
}
```

**Step 3: Adapt api.ts for client-side**

Replace all `import.meta.env.VITE_API_URL` with `process.env.NEXT_PUBLIC_API_URL`.

**Step 4: Adapt api/lessons.ts**

```typescript
// OLD
const API_BASE = "";

// NEW
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
```

**Step 5: Verify with diff**

```bash
git diff web_frontend_next/src/config.ts
git diff web_frontend_next/src/lib/api.ts
git diff web_frontend_next/src/api/lessons.ts
```

**Step 6: Commit**

```bash
jj new -m "feat: adapt config and API clients for Next.js"
```

---

## Task 7: Adapt All Hooks

**Hooks must be adapted before pages, as pages import them.**

**Files:**
- Adapt: `web_frontend_next/src/hooks/useAuth.ts`
- Adapt: `web_frontend_next/src/hooks/useAnonymousSession.ts`
- Adapt: `web_frontend_next/src/hooks/useActivityTracker.ts`
- Adapt: `web_frontend_next/src/hooks/useVideoActivityTracker.ts`
- Adapt: Any other hooks in `src/hooks/`

**Step 1: Add "use client" to all hooks**

Every file in `src/hooks/` needs `"use client"` at the top.

**Step 2: Replace any import.meta.env references**

Search and replace per the environment variable mapping table.

**Step 3: Verify**

```bash
grep -r "import.meta.env" web_frontend_next/src/hooks/
```

Should return 0 results.

**Step 4: Test compilation**

```bash
cd web_frontend_next && npm run build
```

May still fail due to page files, but hooks should not cause errors.

**Step 5: Commit**

```bash
jj new -m "feat: adapt hooks for Next.js"
```

---

## Task 8: Update FastAPI for Cross-Domain Auth

**Files:**
- Modify: `web_api/auth.py`
- Modify: `core/config.py`

**Step 1: Add COOKIE_DOMAIN support**

Update `set_session_cookie` in `web_api/auth.py`:

```python
def set_session_cookie(response: Response, token: str) -> None:
    is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    cookie_domain = os.environ.get("COOKIE_DOMAIN")  # e.g., ".lensacademy.org"

    response.set_cookie(
        key="session",
        value=token,
        httponly=True,
        secure=is_production,
        samesite="lax",
        max_age=60 * 60 * 24,  # 24 hours
        domain=cookie_domain if is_production else None,
    )
```

**Step 2: Update CORS origins**

Add to `core/config.py` `get_allowed_origins()`:

```python
"http://localhost:3000",  # Next.js dev
"http://localhost:3001",  # Next.js dev (alternate port)
```

**Step 3: Commit**

```bash
jj new -m "feat: add COOKIE_DOMAIN support for cross-domain auth"
```

---

## Task 9: Create Next.js Root Layout with Global Components

**Files:**
- Modify: `web_frontend_next/src/app/layout.tsx`
- Create: `web_frontend_next/src/components/Providers.tsx`
- Create: `web_frontend_next/src/components/GlobalComponents.tsx`

**Step 1: Create Providers wrapper for analytics**

Create `web_frontend_next/src/components/Providers.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initPostHog, capturePageView, hasConsent } from "@/analytics";
import { initSentry } from "@/errorTracking";

export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Initialize analytics if user previously consented
  useEffect(() => {
    if (hasConsent()) {
      initPostHog();
      initSentry();
    }
  }, []);

  // Track page views on route change
  useEffect(() => {
    capturePageView(pathname);
  }, [pathname]);

  return <>{children}</>;
}
```

**Step 2: Create GlobalComponents wrapper**

Create `web_frontend_next/src/components/GlobalComponents.tsx`:

```tsx
"use client";

import { useState, useCallback, useEffect } from "react";
import MobileWarning from "./MobileWarning";
import CookieBanner from "./CookieBanner";
import FeedbackButton from "./FeedbackButton";

export function GlobalComponents() {
  // Initialize to false to avoid hydration mismatch
  // (server renders false, client may have localStorage value)
  const [showMobileWarning, setShowMobileWarning] = useState(false);

  useEffect(() => {
    // Check localStorage on client only
    const dismissed = localStorage.getItem("mobileWarningDismissed");
    if (!dismissed) {
      setShowMobileWarning(true);
    }
  }, []);

  const handleContinueAnyway = useCallback(() => {
    setShowMobileWarning(false);
    localStorage.setItem("mobileWarningDismissed", "true");
  }, []);

  return (
    <>
      {showMobileWarning && <MobileWarning onContinue={handleContinueAnyway} />}
      <CookieBanner />
      <FeedbackButton />
    </>
  );
}
```

**Step 3: Update root layout**

Replace `web_frontend_next/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { GlobalComponents } from "@/components/GlobalComponents";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lens Academy | AI Safety Course",
  description:
    "A free, high quality course on AI existential risk. No gatekeeping, no application process.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
          <GlobalComponents />
        </Providers>
      </body>
    </html>
  );
}
```

**Step 4: Add "use client" to global components**

Ensure these files have `"use client"` at the top:
- `src/components/MobileWarning.tsx`
- `src/components/CookieBanner.tsx`
- `src/components/FeedbackButton.tsx`
- `src/components/CookieSettings.tsx`

**Step 5: Commit**

```bash
jj new -m "feat: create Next.js root layout with global components"
```

---

## Task 10: Adapt Lesson Pages (CSR) - CRITICAL PATH

**This is the highest-risk task.** The lesson page contains the `viewedContentCache` state that was lost in v1.

**Files:**
- Create: `web_frontend_next/src/app/course/[courseId]/lesson/[lessonId]/page.tsx`
- Create: `web_frontend_next/src/app/lesson/[lessonId]/page.tsx` (legacy route)
- Adapt: `web_frontend_next/src/pages/UnifiedLesson.tsx`

**Step 1: Verify caching logic exists before changes**

Open `web_frontend_next/src/pages/UnifiedLesson.tsx` and confirm these lines exist:

```typescript
// Around line 60-62 - THIS MUST BE PRESERVED
const [viewedContentCache, setViewedContentCache] = useState<
  Record<number, ArticleData>
>({});
```

If missing, copy from `web_frontend/src/pages/UnifiedLesson.tsx`.

**Step 2: Create thin App Router wrapper**

Create `web_frontend_next/src/app/course/[courseId]/lesson/[lessonId]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import UnifiedLesson from "@/pages/UnifiedLesson";

export default function LessonPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const lessonId = params.lessonId as string;

  return <UnifiedLesson courseId={courseId} lessonSlug={lessonId} />;
}
```

**Step 3: Create legacy route wrapper**

Create `web_frontend_next/src/app/lesson/[lessonId]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import UnifiedLesson from "@/pages/UnifiedLesson";

export default function LegacyLessonPage() {
  const params = useParams();
  const lessonId = params.lessonId as string;

  return <UnifiedLesson lessonSlug={lessonId} />;
}
```

**Step 4: Adapt UnifiedLesson.tsx with MINIMAL changes**

Make ONLY these changes to `web_frontend_next/src/pages/UnifiedLesson.tsx`:

1. Add `"use client"` at top
2. Replace imports:
   ```typescript
   // OLD
   import { useParams, useNavigate } from "react-router-dom";
   // NEW
   import { useRouter } from "next/navigation";
   ```
3. Replace `useNavigate()` usage:
   ```typescript
   // OLD
   const navigate = useNavigate();
   navigate("/course");
   // NEW
   const router = useRouter();
   router.push("/course");
   ```
4. Replace environment variables (if any direct usage)
5. Update props to accept courseId/lessonSlug from wrapper instead of useParams
6. Replace any `<Link to=...>` with `<Link href=...>`

**Step 5: Verify with diff**

```bash
git diff web_frontend_next/src/pages/UnifiedLesson.tsx
```

Confirm:
- `viewedContentCache` state is UNCHANGED
- Only import/hook changes were made
- No logic was modified

**Step 6: Build to verify compilation**

```bash
cd web_frontend_next && npm run build
```

**Step 7: Test lesson page**

```bash
npm run dev
```

Visit http://localhost:3000/course/default/lesson/introduction
- Verify lesson loads
- Verify article caching works (open article, navigate away, come back - should be instant)

**Step 8: Commit**

```bash
jj new -m "feat: adapt lesson pages for Next.js CSR"
```

---

## Task 11: Convert Static Landing Page to React SSR

**The current landing page is `static/landing.html`. We'll convert it to a React Server Component.**

**Files:**
- Create: `web_frontend_next/src/app/page.tsx`
- Create: `web_frontend_next/src/components/LandingNav.tsx`

**Step 1: Create LandingNav component**

Create `web_frontend_next/src/components/LandingNav.tsx`:

```tsx
import Link from "next/link";

const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";

interface LandingNavProps {
  user: {
    discord_username: string;
    discord_avatar_url: string;
  } | null;
}

export function LandingNav({ user }: LandingNavProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-stone-50/70 border-b border-slate-200/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <img
              src="/assets/Logo only.png"
              alt="Lens Academy"
              className="h-8"
            />
            <span className="text-xl font-semibold text-slate-800">
              Lens Academy
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
            >
              Course
            </Link>
            {user ? (
              <div className="flex items-center gap-2">
                <img
                  src={user.discord_avatar_url}
                  alt={user.discord_username}
                  className="w-8 h-8 rounded-full"
                />
                <span className="text-sm text-slate-700">
                  {user.discord_username}
                </span>
              </div>
            ) : (
              /* Use <a> not <Link> - this redirects to FastAPI (external) */
              <a
                href="/auth/discord?next=/course"
                className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
              >
                Sign in
              </a>
            )}
            <a
              href={DISCORD_INVITE_URL}
              className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Join Our Discord Server
            </a>
          </div>
        </div>
      </div>
    </nav>
  );
}
```

**Step 2: Create SSR landing page**

Create `web_frontend_next/src/app/page.tsx`:

```tsx
import Link from "next/link";
import { getCurrentUser } from "@/lib/api-server";
import { LandingNav } from "@/components/LandingNav";

export default async function LandingPage() {
  const user = await getCurrentUser();

  return (
    <div className="h-screen bg-stone-50 text-slate-900 antialiased flex flex-col overflow-hidden">
      <LandingNav user={user} />

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-4 pt-16 relative bg-white">
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-10">
            <span className="block mb-4">Understand AI Safety.</span>
            <span className="text-emerald-600">Help Save Humanity.</span>
          </h1>

          <div className="mb-10 max-w-2xl mx-auto">
            <p className="text-xl sm:text-2xl text-slate-700 font-medium mb-3">
              A free, high quality course on AI existential risk.
            </p>
            <p className="text-xl sm:text-2xl text-slate-500">
              No gatekeeping, no application process.
            </p>
            <p className="text-xl sm:text-2xl text-slate-500 mt-3">
              Get started today. It takes 5 minutes.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/course/default/lesson/introduction"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-emerald-500 text-white font-semibold text-lg hover:bg-emerald-600 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/25 hover:-translate-y-0.5"
            >
              Start Learning
            </Link>
            <Link
              href="/signup"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full border-2 border-slate-200 text-slate-700 font-semibold text-lg hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Sign Up
            </Link>
          </div>
          <p className="text-sm text-slate-500 mt-6">
            Try our intro lesson first, or sign up directly for the full course.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} Lens Academy. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
```

**Step 3: Build and test**

```bash
npm run build && npm run dev
```

Visit http://localhost:3000 - should see landing page with auth status.

**Step 4: Commit**

```bash
jj new -m "feat: convert static landing page to React SSR"
```

---

## Task 12: Adapt Course Overview Page

**Files:**
- Create: `web_frontend_next/src/app/course/page.tsx`
- Create: `web_frontend_next/src/app/course/[courseId]/page.tsx`
- Adapt: `web_frontend_next/src/pages/CourseOverview.tsx`

**Step 1: Add "use client" to CourseOverview.tsx**

Add `"use client"` at top of `web_frontend_next/src/pages/CourseOverview.tsx`.

**Step 2: Update imports in CourseOverview.tsx**

Replace React Router imports with Next.js equivalents:
- `useNavigate()` → `useRouter().push()`
- `<Link to=...>` → `<Link href=...>`

**Step 3: Create App Router pages**

Create `web_frontend_next/src/app/course/page.tsx`:

```tsx
"use client";

import CourseOverview from "@/pages/CourseOverview";

export default function CoursePage() {
  return <CourseOverview />;
}
```

Create `web_frontend_next/src/app/course/[courseId]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import CourseOverview from "@/pages/CourseOverview";

export default function CourseByIdPage() {
  const params = useParams();
  const courseId = params.courseId as string;

  return <CourseOverview courseId={courseId} />;
}
```

**Step 4: Verify with diff and build**

```bash
git diff web_frontend_next/src/pages/CourseOverview.tsx
npm run build
```

**Step 5: Test**

Visit http://localhost:3000/course - should see course overview.

**Step 6: Commit**

```bash
jj new -m "feat: adapt course overview page for Next.js"
```

---

## Task 13: Adapt Remaining Pages

For each page, follow the same pattern:
1. Add `"use client"` directive
2. Update React Router imports → Next.js imports
3. Create thin App Router wrapper
4. Verify with diff
5. Build to verify compilation
6. Test
7. Commit

**Pages to adapt:**

| Route | Wrapper | Existing Component | Notes |
|-------|---------|-------------------|-------|
| `/signup` | `src/app/(with-layout)/signup/page.tsx` | `src/pages/Signup.tsx` | |
| `/availability` | `src/app/(with-layout)/availability/page.tsx` | `src/pages/Availability.tsx` | |
| `/facilitator` | `src/app/(with-layout)/facilitator/page.tsx` | `src/pages/Facilitator.tsx` | |
| `/auth/code` | `src/app/(with-layout)/auth/code/page.tsx` | `src/pages/Auth.tsx` | **Needs `<Suspense>`** (uses `useSearchParams`) |
| `/privacy` | `src/app/(with-layout)/privacy/page.tsx` | `src/pages/Privacy.tsx` | |
| `/terms` | `src/app/(with-layout)/terms/page.tsx` | `src/pages/Terms.tsx` | |

**Special handling for Auth page (uses useSearchParams):**

```tsx
// src/app/(with-layout)/auth/code/page.tsx
"use client";

import { Suspense } from "react";
import Auth from "@/pages/Auth";

function AuthContent() {
  return <Auth />;
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <AuthContent />
    </Suspense>
  );
}
```

**Commit after each page or batch of similar pages.**

---

## Task 14: Create 404 Not Found Page

**Files:**
- Create: `web_frontend_next/src/app/not-found.tsx`
- Reference: `web_frontend_next/src/pages/NotFound.tsx`

**Step 1: Create not-found.tsx**

Next.js uses a special `not-found.tsx` file (not a route wrapper):

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-900 mb-4">404</h1>
        <p className="text-xl text-slate-600 mb-8">Page not found</p>
        <Link
          href="/"
          className="px-6 py-3 bg-emerald-500 text-white rounded-full hover:bg-emerald-600 transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
jj new -m "feat: add 404 not found page"
```

---

## Task 15: Create Layout for Standard Pages

**The old App.tsx wrapped some pages in `<Layout />` with `<Outlet />`. We need a Next.js layout.**

**Files:**
- Adapt: `web_frontend_next/src/components/Layout.tsx`
- Create: `web_frontend_next/src/app/(with-layout)/layout.tsx`

**Step 1: Adapt Layout.tsx**

The existing Layout uses `<Outlet />` and `<Link to=...>`. Convert:

```tsx
// OLD
import { Outlet, Link } from "react-router-dom";
export default function Layout() {
  return (
    <div>
      <Nav />
      <Outlet />
      <Footer />
    </div>
  );
}

// NEW
import Link from "next/link";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Nav />
      {children}
      <Footer />
    </div>
  );
}
```

Also update any `<Link to=...>` inside Nav/Footer components to `<Link href=...>`.

**Step 2: Create route group layout**

Create `web_frontend_next/src/app/(with-layout)/layout.tsx`:

```tsx
import Layout from "@/components/Layout";

export default function WithLayoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Layout>{children}</Layout>;
}
```

**Step 3: Verify all Link components converted**

```bash
grep -r '<Link to=' web_frontend_next/src/components/
```

Should return 0 results.

**Step 4: Commit**

```bash
jj new -m "feat: create layout for standard pages"
```

---

## Task 16: Adapt Analytics and Error Tracking

**Files:**
- Adapt: `web_frontend_next/src/analytics.ts`
- Adapt: `web_frontend_next/src/errorTracking.ts`

**Step 1: Update analytics.ts**

Replace all `import.meta.env.VITE_*` with `process.env.NEXT_PUBLIC_*`.

**Step 2: Update errorTracking.ts**

Replace all `import.meta.env.VITE_*` with `process.env.NEXT_PUBLIC_*`.

**Step 3: Verify with diff**

```bash
git diff web_frontend_next/src/analytics.ts
git diff web_frontend_next/src/errorTracking.ts
```

Confirm only environment variable changes.

**Step 4: Commit**

```bash
jj new -m "feat: adapt analytics and error tracking for Next.js"
```

---

## Task 17: Set Up Sentry for Next.js

**Step 1: Run Sentry wizard**

```bash
cd web_frontend_next
npx @sentry/wizard@latest -i nextjs
```

Follow prompts to configure Sentry.

**Step 2: Verify config files created**

- `sentry.client.config.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- Updated `next.config.js` with Sentry plugin

**Step 3: Commit**

```bash
jj new -m "feat: set up Sentry for Next.js"
```

---

## Task 18: Final Verification and Cleanup

**Only after all pages are working.**

**Step 1: Run automated verification**

```bash
# Should all return 0 results
grep -r "import.meta.env" web_frontend_next/src/
grep -r "react-router-dom" web_frontend_next/src/
grep -r '<Link to=' web_frontend_next/src/
grep -r "from 'react-router" web_frontend_next/src/
```

**Step 2: Full build test**

```bash
cd web_frontend_next && npm run build
```

Should complete without errors.

**Step 3: Remove react-router-dom from package.json**

```bash
npm uninstall react-router-dom
```

**Step 4: Clean up old pages directory (optional)**

The `src/pages/` directory contains Vite page components. They're now just React components imported by App Router wrappers. You can:
- Keep them where they are (they work fine)
- Move to `src/components/pages/` for clarity

**Step 5: Commit**

```bash
jj new -m "chore: final cleanup - remove react-router-dom"
```

---

## Task 19: Deploy to Vercel

**Step 1: Create Vercel project**

```bash
cd web_frontend_next
vercel
```

**Step 2: Set environment variables**

```bash
vercel env add NEXT_PUBLIC_API_URL production
# Enter: https://api.lensacademy.org

vercel env add API_URL production
# Enter: https://api.lensacademy.org

# Add other env vars as needed (PostHog, Sentry, etc.)
```

**Step 3: Deploy**

```bash
vercel --prod
```

**Step 4: Configure custom domain**

In Vercel dashboard → Domains → Add `lensacademy.org`

**Step 5: Update Railway environment**

Add to Railway:
- `COOKIE_DOMAIN=.lensacademy.org`
- `FRONTEND_URL=https://lensacademy.org`

---

## Summary

After completing all tasks:

**Vercel (lensacademy.org):**
- Landing page (SSR) with auth status
- Course overview (CSR)
- Lesson pages (CSR) with full interactivity - **including client-side caching**
- All other pages (CSR)

**Railway (api.lensacademy.org):**
- FastAPI API endpoints
- Discord OAuth flow
- Discord bot

**Cookie sharing:**
- Session cookie set on `.lensacademy.org`
- Works for both Vercel and Railway subdomains

**Key preservation:**
- `viewedContentCache` state in UnifiedLesson.tsx - verified at Task 10 Step 1
- All existing component logic - enforced by diff verification

**Verification commands:**
```bash
# Confirm no Vite/React Router remnants
grep -r "import.meta.env" web_frontend_next/src/
grep -r "react-router-dom" web_frontend_next/src/
grep -r '<Link to=' web_frontend_next/src/

# Confirm build succeeds
cd web_frontend_next && npm run build
```
