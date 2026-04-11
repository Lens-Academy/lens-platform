# Next.js Migration to Vercel

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
| `/auth/*` | Redirect to API | OAuth flow stays on FastAPI |

### 3. API Calls

- **SSR (server components):** Call FastAPI directly with forwarded cookies
- **CSR (client components):** Call FastAPI via browser fetch with credentials

---

## Task 1: Create Next.js Project

**Files:**
- Create: `web_frontend_next/` (new directory)
- Keep: `web_frontend/` (for reference during migration)

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
npm install posthog-js @sentry/nextjs
```

**Step 3: Verify it runs**

```bash
npm run dev
```

Visit http://localhost:3000 - should see Next.js welcome page.

**Step 4: Commit**

```bash
jj new -m "feat: initialize Next.js project"
```

---

## Task 2: Configure Tailwind and Global Styles

**Files:**
- Modify: `web_frontend_next/src/app/globals.css`
- Modify: `web_frontend_next/tailwind.config.ts`

**Step 1: Copy Tailwind config**

The current frontend uses Tailwind v4 with the Vite plugin. Next.js uses the standard Tailwind setup.

Replace `web_frontend_next/tailwind.config.ts`:

```typescript
import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
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

Replace `web_frontend_next/src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-stone-50 text-slate-900 antialiased;
}
```

**Step 4: Verify styles work**

Edit `src/app/page.tsx` temporarily:

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold text-emerald-600">Tailwind works!</h1>
    </main>
  );
}
```

Run `npm run dev` and verify green heading appears.

**Step 5: Commit**

```bash
jj new -m "feat: configure Tailwind CSS"
```

---

## Task 3: Set Up Environment Variables and API Client

**Files:**
- Create: `web_frontend_next/.env.local`
- Create: `web_frontend_next/.env.example`
- Create: `web_frontend_next/src/lib/api.ts`
- Create: `web_frontend_next/src/lib/config.ts`

**Step 1: Create environment files**

Create `web_frontend_next/.env.example`:

```bash
# API URL for the FastAPI backend
NEXT_PUBLIC_API_URL=http://localhost:8000

# Internal API URL (for server-side requests, can be internal network)
API_URL=http://localhost:8000
```

Create `web_frontend_next/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
API_URL=http://localhost:8000
```

**Step 2: Create config module**

Create `web_frontend_next/src/lib/config.ts`:

```typescript
// Client-side config (exposed to browser)
export const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

// Server-side config (not exposed to browser)
export const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "";

// Discord invite URL
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
```

**Step 3: Create API client for server components**

Create `web_frontend_next/src/lib/api.ts`:

```typescript
import { cookies } from "next/headers";
import { API_URL } from "./config";

/**
 * Fetch from API with session cookie forwarded (for SSR).
 * Use this in Server Components.
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
export async function getCurrentUser(): Promise<{
  authenticated: boolean;
  discord_id?: string;
  discord_username?: string;
  discord_avatar_url?: string;
} | null> {
  try {
    const data = await apiFetch<{ authenticated: boolean; [key: string]: unknown }>("/auth/me");
    return data.authenticated ? data as any : null;
  } catch {
    return null;
  }
}
```

**Step 4: Commit**

```bash
jj new -m "feat: add API client and config"
```

---

## Task 4: Create Shared Layout and Navigation

**Files:**
- Create: `web_frontend_next/src/components/Nav.tsx`
- Create: `web_frontend_next/src/components/Footer.tsx`
- Modify: `web_frontend_next/src/app/layout.tsx`

**Step 1: Create Nav component**

Create `web_frontend_next/src/components/Nav.tsx`:

```tsx
import Link from "next/link";
import { DISCORD_INVITE_URL } from "@/lib/config";
import { AuthStatus } from "./AuthStatus";

interface NavProps {
  user: {
    discord_username: string;
    discord_avatar_url: string;
  } | null;
}

export function Nav({ user }: NavProps) {
  return (
    <nav className="border-b border-slate-200/50 bg-stone-50">
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
            <a
              href={DISCORD_INVITE_URL}
              className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Join Our Discord
            </a>
            <AuthStatus user={user} />
          </div>
        </div>
      </div>
    </nav>
  );
}
```

**Step 2: Create AuthStatus component (client component for interactivity)**

Create `web_frontend_next/src/components/AuthStatus.tsx`:

```tsx
"use client";

import { PUBLIC_API_URL } from "@/lib/config";

interface AuthStatusProps {
  user: {
    discord_username: string;
    discord_avatar_url: string;
  } | null;
}

export function AuthStatus({ user }: AuthStatusProps) {
  const handleLogin = () => {
    const next = encodeURIComponent(window.location.pathname);
    const origin = encodeURIComponent(window.location.origin);
    window.location.href = `${PUBLIC_API_URL}/auth/discord?next=${next}&origin=${origin}`;
  };

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <img
          src={user.discord_avatar_url}
          alt={user.discord_username}
          className="w-8 h-8 rounded-full"
        />
        <span className="text-sm text-slate-700">{user.discord_username}</span>
      </div>
    );
  }

  return (
    <button
      onClick={handleLogin}
      className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
    >
      Sign in
    </button>
  );
}
```

**Step 3: Create Footer component**

Create `web_frontend_next/src/components/Footer.tsx`:

```tsx
export function Footer() {
  return (
    <footer className="py-8 border-t border-slate-200">
      <div className="max-w-6xl mx-auto px-4 text-center">
        <p className="text-sm text-slate-500">
          &copy; {new Date().getFullYear()} Lens Academy. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
```

**Step 4: Update root layout**

Replace `web_frontend_next/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

**Step 5: Copy static assets**

```bash
cp -r ../web_frontend/public/* ./public/
```

**Step 6: Commit**

```bash
jj new -m "feat: add shared Nav, Footer, AuthStatus components"
```

---

## Task 5: Create Landing Page (SSR)

**Files:**
- Modify: `web_frontend_next/src/app/page.tsx`

**Step 1: Create the landing page**

Replace `web_frontend_next/src/app/page.tsx`:

```tsx
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { getCurrentUser } from "@/lib/api";
import { DISCORD_INVITE_URL } from "@/lib/config";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav user={user} />

      <main className="flex-1 flex items-center justify-center px-4 bg-white">
        <div className="max-w-3xl mx-auto text-center">
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

      <Footer />
    </div>
  );
}
```

**Step 2: Test with API running**

Start FastAPI:
```bash
cd .. && python main.py --no-bot --dev
```

In another terminal, start Next.js:
```bash
cd web_frontend_next && npm run dev
```

Visit http://localhost:3000 - should see landing page with sign in button (or avatar if you have a session cookie).

**Step 3: Commit**

```bash
jj new -m "feat: create SSR landing page"
```

---

## Task 6: Create Course Overview Page (SSR)

**Files:**
- Create: `web_frontend_next/src/app/course/page.tsx`
- Create: `web_frontend_next/src/app/course/[courseId]/page.tsx`
- Create: `web_frontend_next/src/lib/types.ts`

**Step 1: Create types**

Create `web_frontend_next/src/lib/types.ts`:

```typescript
export interface StageInfo {
  type: "article" | "video" | "chat";
  title: string;
  duration: string | null;
  optional: boolean;
}

export interface LessonInfo {
  slug: string;
  title: string;
  stages: StageInfo[];
  status: "completed" | "in_progress" | "not_started";
  currentStageIndex: number | null;
  sessionId: number | null;
  optional: boolean;
}

export interface UnitInfo {
  meetingNumber: number | null;
  lessons: LessonInfo[];
}

export interface CourseProgress {
  course: {
    slug: string;
    title: string;
  };
  units: UnitInfo[];
}
```

**Step 2: Create course page components**

Create `web_frontend_next/src/components/course/LessonCard.tsx`:

```tsx
import Link from "next/link";
import { FileText, Play, MessageCircle, Check } from "lucide-react";
import type { LessonInfo, StageInfo } from "@/lib/types";

function StageIcon({ type }: { type: StageInfo["type"] }) {
  switch (type) {
    case "video":
      return <Play className="w-4 h-4" />;
    case "chat":
      return <MessageCircle className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
}

interface LessonCardProps {
  lesson: LessonInfo;
  courseSlug: string;
}

export function LessonCard({ lesson, courseSlug }: LessonCardProps) {
  const isCompleted = lesson.status === "completed";
  const isInProgress = lesson.status === "in_progress";

  return (
    <Link
      href={`/course/${courseSlug}/lesson/${lesson.slug}`}
      className="block p-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {isCompleted && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600">
                <Check className="w-3 h-3" />
              </span>
            )}
            {isInProgress && (
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            )}
            <h3 className="font-medium text-slate-900 truncate">
              {lesson.title}
            </h3>
          </div>
          <div className="flex items-center gap-3 mt-2 text-sm text-slate-500">
            {lesson.stages.map((stage, i) => (
              <span key={i} className="flex items-center gap-1">
                <StageIcon type={stage.type} />
                {stage.title}
              </span>
            ))}
          </div>
        </div>
        {lesson.optional && (
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">
            Optional
          </span>
        )}
      </div>
    </Link>
  );
}
```

**Step 3: Create course overview page**

Create `web_frontend_next/src/app/course/[courseId]/page.tsx`:

```tsx
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { LessonCard } from "@/components/course/LessonCard";
import { apiFetch, getCurrentUser } from "@/lib/api";
import type { CourseProgress } from "@/lib/types";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

interface PageProps {
  params: Promise<{ courseId: string }>;
}

export default async function CoursePage({ params }: PageProps) {
  const { courseId } = await params;
  const [user, courseProgress] = await Promise.all([
    getCurrentUser(),
    apiFetch<CourseProgress>(`/api/courses/${courseId}/progress`),
  ]);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Nav user={user} />

      {/* Breadcrumb */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-2 text-sm">
        <Link href="/" className="text-slate-500 hover:text-slate-700">
          Home
        </Link>
        <ChevronRight className="w-4 h-4 text-slate-400" />
        <span className="text-slate-700 font-medium">
          {courseProgress.course.title}
        </span>
      </div>

      {/* Main content */}
      <main className="flex-1 max-w-4xl mx-auto px-6 py-8 w-full">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">
          {courseProgress.course.title}
        </h1>
        <p className="text-slate-600 mb-8">
          Work through the units below at your own pace.
          {!user && " Sign in to track your progress."}
        </p>

        {courseProgress.units.map((unit, i) => (
          <div key={i} className="mb-8">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              {unit.meetingNumber !== null
                ? `Unit ${unit.meetingNumber}`
                : "Additional Content"}
            </h2>
            <div className="space-y-3">
              {unit.lessons.map((lesson) => (
                <LessonCard
                  key={lesson.slug}
                  lesson={lesson}
                  courseSlug={courseProgress.course.slug}
                />
              ))}
            </div>
          </div>
        ))}
      </main>

      <Footer />
    </div>
  );
}
```

**Step 4: Create redirect for /course to /course/default**

Create `web_frontend_next/src/app/course/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function CourseIndexPage() {
  redirect("/course/default");
}
```

**Step 5: Test the course page**

Visit http://localhost:3000/course - should see course structure with lessons.

**Step 6: Commit**

```bash
jj new -m "feat: create SSR course overview page"
```

---

## Task 7: Update FastAPI Cookie Domain for Cross-Domain Auth

**Files:**
- Modify: `web_api/auth.py`
- Modify: `core/__init__.py` or create `core/config.py`

**Step 1: Add COOKIE_DOMAIN config**

Add to environment variables (will be set in Railway):
- `COOKIE_DOMAIN=.lensacademy.org` (production)
- Not set in dev (defaults to request domain)

**Step 2: Update set_session_cookie**

Modify `web_api/auth.py`, update the `set_session_cookie` function:

```python
def set_session_cookie(response: Response, token: str) -> None:
    """
    Set the session cookie with the JWT token.

    In production, sets domain to allow cross-subdomain sharing
    between lensacademy.org (Vercel) and api.lensacademy.org (Railway).
    """
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

**Step 3: Update logout to clear cookie on correct domain**

In `web_api/routes/auth.py`, update the logout endpoint:

```python
@router.post("/logout")
async def logout(response: Response):
    """Clear the session cookie."""
    is_production = bool(os.environ.get("RAILWAY_ENVIRONMENT"))
    cookie_domain = os.environ.get("COOKIE_DOMAIN")

    response.delete_cookie(
        key="session",
        domain=cookie_domain if is_production else None,
    )
    return {"status": "logged_out"}
```

**Step 4: Commit**

```bash
jj new -m "feat: add COOKIE_DOMAIN support for cross-domain auth"
```

---

## Task 8: Migrate Lesson Pages (Client-Side Rendering)

**Files:**
- Create: `web_frontend_next/src/app/course/[courseId]/lesson/[lessonId]/page.tsx`
- Copy and adapt components from `web_frontend/src/components/unified-lesson/`

**Step 1: Create lesson page wrapper**

The lesson page is highly interactive (video player, chat, stage navigation). We'll make it a client component that loads after the initial page render.

Create `web_frontend_next/src/app/course/[courseId]/lesson/[lessonId]/page.tsx`:

```tsx
import { Metadata } from "next";
import { apiFetch } from "@/lib/api";
import { LessonClient } from "./LessonClient";

interface PageProps {
  params: Promise<{ courseId: string; lessonId: string }>;
}

// Generate metadata for SEO
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lessonId } = await params;

  try {
    const lesson = await apiFetch<{ title: string }>(`/api/lessons/${lessonId}`);
    return {
      title: `${lesson.title} | Lens Academy`,
      description: `Learn about ${lesson.title} in this interactive lesson.`,
    };
  } catch {
    return {
      title: "Lesson | Lens Academy",
    };
  }
}

export default async function LessonPage({ params }: PageProps) {
  const { courseId, lessonId } = await params;

  return <LessonClient courseId={courseId} lessonId={lessonId} />;
}
```

**Step 2: Create client component wrapper**

Create `web_frontend_next/src/app/course/[courseId]/lesson/[lessonId]/LessonClient.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { PUBLIC_API_URL } from "@/lib/config";

// This is a placeholder - you'll migrate the actual UnifiedLesson component
// For now, redirect to the old frontend or show a basic lesson view

interface LessonClientProps {
  courseId: string;
  lessonId: string;
}

export function LessonClient({ courseId, lessonId }: LessonClientProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Migrate full lesson functionality
    // For now, this is a placeholder
    setLoading(false);
  }, [lessonId]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-slate-500">Loading lesson...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Lesson: {lessonId}</h1>
        <p className="text-slate-600 mb-4">
          Full lesson UI migration in progress.
        </p>
        <a
          href={`${PUBLIC_API_URL}/course/${courseId}/lesson/${lessonId}`}
          className="text-emerald-600 hover:underline"
        >
          View on current site →
        </a>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
jj new -m "feat: add lesson page placeholder (CSR)"
```

---

## Task 9: Deploy to Vercel

**Files:**
- Create: `web_frontend_next/vercel.json`

**Step 1: Create Vercel config**

Create `web_frontend_next/vercel.json`:

```json
{
  "framework": "nextjs",
  "regions": ["iad1"],
  "env": {
    "NEXT_PUBLIC_API_URL": "https://api.lensacademy.org",
    "API_URL": "https://api.lensacademy.org"
  }
}
```

**Step 2: Install Vercel CLI**

```bash
npm install -g vercel
```

**Step 3: Link to Vercel project**

```bash
cd web_frontend_next
vercel link
```

Follow prompts to create/link a Vercel project.

**Step 4: Set environment variables in Vercel**

```bash
vercel env add NEXT_PUBLIC_API_URL production
# Enter: https://api.lensacademy.org

vercel env add API_URL production
# Enter: https://api.lensacademy.org
```

**Step 5: Deploy**

```bash
vercel --prod
```

**Step 6: Configure custom domain in Vercel dashboard**

1. Go to Vercel dashboard → Project Settings → Domains
2. Add `lensacademy.org`
3. Follow DNS configuration instructions

**Step 7: Commit**

```bash
jj new -m "chore: add Vercel deployment config"
```

---

## Task 10: Update Railway FastAPI for API-Only Mode

**Files:**
- Modify: `main.py`
- Add Railway environment variable: `COOKIE_DOMAIN=.lensacademy.org`

**Step 1: Update FastAPI to skip frontend serving**

In production, FastAPI should only serve API routes. Update `main.py`:

```python
# Near the end of the file, replace the SPA catch-all section:

# Only serve frontend in non-production (local dev without Vercel)
if not is_production():
    if spa_path.exists():
        # Mount static assets from built SPA
        assets_path = spa_path / "assets"
        if assets_path.exists():
            app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

        @app.get("/{full_path:path}")
        async def spa_catchall(full_path: str):
            """Serve React SPA for frontend routes (dev only)."""
            if full_path.startswith("api/") or full_path.startswith("auth/"):
                raise HTTPException(status_code=404, detail="Not found")

            static_file = spa_path / full_path
            if static_file.exists() and static_file.is_file():
                return FileResponse(static_file)

            return FileResponse(spa_path / "index.html")
```

**Step 2: Add COOKIE_DOMAIN to Railway**

In Railway dashboard:
1. Go to your service → Variables
2. Add: `COOKIE_DOMAIN=.lensacademy.org`
3. Add: `FRONTEND_URL=https://lensacademy.org`

**Step 3: Update CORS origins**

Update `core/__init__.py` or wherever `get_allowed_origins` is defined to include the Vercel domain:

```python
def get_allowed_origins() -> list[str]:
    if is_production():
        return [
            "https://lensacademy.org",
            "https://www.lensacademy.org",
            "https://api.lensacademy.org",
            # Add any preview URLs if needed
        ]
    return [
        f"http://localhost:{get_vite_port()}",
        f"http://localhost:{get_api_port()}",
        "http://localhost:3000",  # Next.js dev
    ]
```

**Step 4: Deploy to Railway**

```bash
railway up
```

**Step 5: Commit**

```bash
jj new -m "feat: configure FastAPI for API-only production mode"
```

---

## Task 11: Migrate Remaining Pages

After the core infrastructure is working, migrate remaining pages:

### Signup Page (CSR)
- Copy `web_frontend/src/pages/Signup.tsx` → adapt to Next.js
- Copy signup components from `web_frontend/src/components/signup/`

### Auth Callback Page
- Create `web_frontend_next/src/app/auth/code/page.tsx`
- Handle auth code validation

### Privacy/Terms Pages (Static)
- Copy content to `web_frontend_next/src/app/privacy/page.tsx`
- Copy content to `web_frontend_next/src/app/terms/page.tsx`

---

## Task 12: Full Lesson UI Migration

This is the largest task - migrating the interactive lesson experience:

**Components to migrate:**
- `UnifiedLesson.tsx` → main lesson page
- `VideoPlayer.tsx` → video playback
- `ArticlePanel.tsx` → article rendering
- `ChatPanel.tsx` → AI chat interface
- `StageProgressBar.tsx` → progress indicator
- `LessonHeader.tsx` → lesson navigation

**Approach:**
1. Copy components to `web_frontend_next/src/components/lesson/`
2. Mark them as `"use client"` since they're interactive
3. Update imports (`import.meta.env` → Next.js env)
4. Update API calls to use `PUBLIC_API_URL`
5. Test each component individually

---

## Summary

After completing all tasks:

**Vercel (lensacademy.org):**
- Landing page (SSR) with auth status
- Course overview (SSR) with user progress
- Lesson pages (CSR) with full interactivity
- All other pages

**Railway (api.lensacademy.org):**
- FastAPI API endpoints
- Discord OAuth flow
- Discord bot

**Cookie sharing:**
- Session cookie set on `.lensacademy.org`
- Works for both Vercel and Railway subdomains
