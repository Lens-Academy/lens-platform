# Static Pre-rendering for SEO

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pre-render landing page and course overview at build time for SEO and social sharing previews.

**Architecture:** Add a Node.js build script that runs after `vite build`. It renders React components to static HTML files with proper meta tags. FastAPI serves these static files for `/` and `/course/*`. No runtime SSR needed.

**Tech Stack:** React, react-dom/server, Node.js build script, Vite

---

## Background

### Problem
- Social media crawlers (Twitter, Slack, Discord) don't execute JavaScript
- Current SPA shows empty `<div id="root"></div>` to crawlers
- Landing page is static HTML but uses CDN Tailwind (inconsistent with React app styles)
- Course page shows "Loading..." until JS fetches data

### Solution
- Pre-render landing page and course overview at build time
- Include Open Graph meta tags for social sharing
- Keep lesson pages as SPA (they're interactive, don't need SEO)

### What We're NOT Doing
- No runtime SSR (no Next.js, no Node server)
- No hydration (pre-rendered pages are static, links navigate to SPA)
- No per-user rendering (course page shows "logged out" view for everyone)

---

## Task 1: Create Pre-render Script Infrastructure

**Files:**
- Create: `web_frontend/scripts/prerender.ts`
- Create: `web_frontend/scripts/tsconfig.json`
- Modify: `web_frontend/package.json`

**Step 1: Create tsconfig for scripts**

Create `web_frontend/scripts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "../dist-scripts",
    "rootDir": ".",
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["*.ts", "*.tsx"]
}
```

**Step 2: Create the pre-render script skeleton**

Create `web_frontend/scripts/prerender.ts`:

```typescript
/**
 * Pre-render static HTML for SEO-critical pages.
 * Runs after vite build to generate static HTML files.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist");

interface PageConfig {
  path: string; // URL path, e.g., "/course"
  outputFile: string; // Output file relative to dist, e.g., "course/index.html"
  title: string;
  description: string;
  render: () => string; // Function that returns HTML body content
}

function generateHtml(page: PageConfig, viteManifest: Record<string, unknown>): string {
  const content = page.render();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${page.title}</title>
    <meta name="description" content="${page.description}" />

    <!-- Open Graph -->
    <meta property="og:title" content="${page.title}" />
    <meta property="og:description" content="${page.description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://lensacademy.ai${page.path}" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${page.title}" />
    <meta name="twitter:description" content="${page.description}" />

    <!-- Favicon -->
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="manifest" href="/site.webmanifest">

    <!-- Styles from Vite build -->
    <link rel="stylesheet" href="/assets/index.css">
  </head>
  <body class="bg-stone-50 text-slate-900 antialiased">
    ${content}
  </body>
</html>`;
}

async function prerender() {
  console.log("Pre-rendering static pages...");

  // Pages will be added in subsequent tasks
  const pages: PageConfig[] = [];

  for (const page of pages) {
    const html = generateHtml(page, {});
    const outputPath = join(DIST_DIR, page.outputFile);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, html);
    console.log(`  ✓ ${page.path} → ${page.outputFile}`);
  }

  console.log("Pre-rendering complete!");
}

prerender().catch((err) => {
  console.error("Pre-render failed:", err);
  process.exit(1);
});
```

**Step 3: Add build script to package.json**

Modify `web_frontend/package.json`, change the build script:

```json
{
  "scripts": {
    "build": "tsc -b && vite build && npm run prerender",
    "prerender": "npx tsx scripts/prerender.ts"
  }
}
```

**Step 4: Install tsx for running TypeScript**

```bash
cd web_frontend && npm install -D tsx
```

**Step 5: Test the script runs**

```bash
cd web_frontend && npm run prerender
```

Expected: Script runs and prints "Pre-rendering static pages..." with no errors.

**Step 6: Commit**

```bash
jj new -m "feat: add pre-render script infrastructure"
```

---

## Task 2: Pre-render Landing Page

**Files:**
- Create: `web_frontend/scripts/pages/landing.tsx`
- Modify: `web_frontend/scripts/prerender.ts`

**Step 1: Create landing page component**

Create `web_frontend/scripts/pages/landing.tsx`:

```tsx
/**
 * Landing page content for pre-rendering.
 * This mirrors the static/landing.html but uses React for consistency.
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";

function LandingPage() {
  return (
    <>
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-stone-50/70 border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="/" className="flex items-center gap-2">
              <img src="/assets/Logo only.png" alt="Lens Academy" className="h-8" />
              <span className="text-xl font-semibold text-slate-800">Lens Academy</span>
            </a>
            <div className="flex items-center gap-4">
              <a
                href="/course"
                className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
              >
                Course
              </a>
              <a
                href="/auth/discord?next=/course"
                className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
              >
                Sign in
              </a>
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

      {/* Hero */}
      <main className="min-h-screen flex items-center justify-center px-4 pt-16 relative bg-white">
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
            <a
              href="/course/default/lesson/introduction"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full bg-emerald-500 text-white font-semibold text-lg hover:bg-emerald-600 transition-all duration-200 hover:shadow-xl hover:shadow-emerald-500/25 hover:-translate-y-0.5"
            >
              Start Learning
            </a>
            <a
              href="/signup"
              className="w-full sm:w-auto px-8 py-3.5 rounded-full border-2 border-slate-200 text-slate-700 font-semibold text-lg hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Sign Up
            </a>
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
    </>
  );
}

export function renderLandingPage(): string {
  return renderToStaticMarkup(<LandingPage />);
}
```

**Step 2: Add landing page to prerender script**

Modify `web_frontend/scripts/prerender.ts`, add import and page config:

```typescript
// Add at top with other imports
import { renderLandingPage } from "./pages/landing.js";

// Replace the empty pages array with:
const pages: PageConfig[] = [
  {
    path: "/",
    outputFile: "index.html",
    title: "Lens Academy | AI Safety Course",
    description: "A free, high quality course on AI existential risk. No gatekeeping, no application process.",
    render: renderLandingPage,
  },
];
```

**Step 3: Run build and verify**

```bash
cd web_frontend && npm run build
```

Then check the output:

```bash
head -50 web_frontend/dist/index.html
```

Expected: Full HTML with nav, hero content, meta tags.

**Step 4: Test locally**

```bash
cd web_frontend && npm run preview
```

Visit http://localhost:4173/ - should show the landing page.

**Step 5: Commit**

```bash
jj new -m "feat: pre-render landing page from React component"
```

---

## Task 3: Pre-render Course Overview Page

**Files:**
- Create: `web_frontend/scripts/pages/course.tsx`
- Create: `web_frontend/scripts/load-course-data.ts`
- Modify: `web_frontend/scripts/prerender.ts`

**Step 1: Create course data loader**

We need to load course data at build time. The simplest approach is to read the YAML files directly (same as the Python backend does).

Create `web_frontend/scripts/load-course-data.ts`:

```typescript
/**
 * Load course data from YAML files for pre-rendering.
 * Mirrors core/lessons/course_loader.py logic.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COURSES_DIR = join(__dirname, "..", "..", "courses");
const LESSONS_DIR = join(__dirname, "..", "..", "lessons");

interface Stage {
  type: "article" | "video" | "chat";
  title?: string;
  article?: string;
  video_id?: string;
  optional?: boolean;
}

interface Lesson {
  slug: string;
  title: string;
  stages: Stage[];
}

interface CourseProgression {
  type: "lesson" | "meeting";
  slug?: string;
  optional?: boolean;
  number?: number;
}

interface Course {
  slug: string;
  title: string;
  progression: CourseProgression[];
}

export interface StageInfo {
  type: "article" | "video" | "chat";
  title: string;
  optional: boolean;
}

export interface LessonInfo {
  slug: string;
  title: string;
  stages: StageInfo[];
  optional: boolean;
}

export interface UnitInfo {
  meetingNumber: number | null;
  lessons: LessonInfo[];
}

export interface CourseData {
  course: {
    slug: string;
    title: string;
  };
  units: UnitInfo[];
}

function loadLesson(slug: string): Lesson | null {
  const lessonPath = join(LESSONS_DIR, slug, "lesson.yaml");
  try {
    const content = readFileSync(lessonPath, "utf-8");
    const data = parseYaml(content) as Omit<Lesson, "slug">;
    return { slug, ...data };
  } catch {
    console.warn(`Warning: Could not load lesson ${slug}`);
    return null;
  }
}

function getStageTitle(stage: Stage): string {
  if (stage.title) return stage.title;
  if (stage.type === "article") return "Article";
  if (stage.type === "video") return "Video";
  if (stage.type === "chat") return "Discussion";
  return "Content";
}

export function loadCourseData(courseSlug: string): CourseData {
  const coursePath = join(COURSES_DIR, courseSlug, "course.yaml");
  const content = readFileSync(coursePath, "utf-8");
  const course = parseYaml(content) as Course;

  const units: UnitInfo[] = [];
  let currentLessons: LessonInfo[] = [];
  let currentMeetingNumber: number | null = null;

  for (const item of course.progression) {
    if (item.type === "meeting") {
      if (currentLessons.length > 0) {
        units.push({
          meetingNumber: item.number ?? null,
          lessons: currentLessons,
        });
        currentLessons = [];
      }
      currentMeetingNumber = item.number ?? null;
    } else if (item.type === "lesson" && item.slug) {
      const lesson = loadLesson(item.slug);
      if (lesson) {
        currentLessons.push({
          slug: lesson.slug,
          title: lesson.title,
          optional: item.optional ?? false,
          stages: lesson.stages.map((s) => ({
            type: s.type,
            title: getStageTitle(s),
            optional: s.optional ?? false,
          })),
        });
      }
    }
  }

  // Handle remaining lessons
  if (currentLessons.length > 0) {
    const meetingNum = currentMeetingNumber !== null ? currentMeetingNumber + 1 : 1;
    units.push({
      meetingNumber: meetingNum,
      lessons: currentLessons,
    });
  }

  return {
    course: {
      slug: course.slug,
      title: course.title,
    },
    units,
  };
}
```

**Step 2: Install yaml parser**

```bash
cd web_frontend && npm install -D yaml
```

**Step 3: Create course overview component**

Create `web_frontend/scripts/pages/course.tsx`:

```tsx
/**
 * Course overview page for pre-rendering.
 * Shows course structure without user progress (logged-out view).
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CourseData, UnitInfo, LessonInfo, StageInfo } from "../load-course-data.js";

const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";

function StageIcon({ type }: { type: StageInfo["type"] }) {
  if (type === "video") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (type === "chat") {
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    );
  }
  // article
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function LessonCard({ lesson, courseSlug }: { lesson: LessonInfo; courseSlug: string }) {
  return (
    <a
      href={`/course/${courseSlug}/lesson/${lesson.slug}`}
      className="block p-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-slate-900 truncate">{lesson.title}</h3>
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
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">Optional</span>
        )}
      </div>
    </a>
  );
}

function UnitSection({ unit, courseSlug }: { unit: UnitInfo; courseSlug: string }) {
  const title = unit.meetingNumber !== null ? `Unit ${unit.meetingNumber}` : "Additional Content";

  return (
    <div className="mb-8">
      <h2 className="text-lg font-semibold text-slate-800 mb-4">{title}</h2>
      <div className="space-y-3">
        {unit.lessons.map((lesson) => (
          <LessonCard key={lesson.slug} lesson={lesson} courseSlug={courseSlug} />
        ))}
      </div>
    </div>
  );
}

function CourseOverviewPage({ data }: { data: CourseData }) {
  return (
    <>
      {/* Nav Header */}
      <nav className="border-b border-slate-200/50 bg-stone-50">
        <div className="px-6 flex items-center justify-between h-14">
          <a href="/" className="flex items-center gap-2">
            <img src="/assets/Logo only.png" alt="Lens Academy" className="h-7" />
            <span className="text-lg font-semibold text-slate-800">Lens Academy</span>
          </a>
          <div className="flex items-center gap-4">
            <a
              href="/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
            >
              Course
            </a>
            <a
              href={DISCORD_INVITE_URL}
              className="px-5 py-2 rounded-full border-2 border-slate-200 text-slate-700 font-medium text-sm hover:border-slate-300 hover:bg-slate-50 transition-all duration-200"
            >
              Join us on Discord
            </a>
            <a
              href="/auth/discord?next=/course"
              className="text-slate-600 font-medium text-sm hover:text-slate-900 transition-colors duration-200"
            >
              Sign in
            </a>
          </div>
        </div>
      </nav>

      {/* Breadcrumb */}
      <div className="border-b border-slate-200 px-6 py-3 flex items-center gap-2 text-sm bg-white">
        <a href="/" className="text-slate-500 hover:text-slate-700">Home</a>
        <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-slate-700 font-medium">{data.course.title}</span>
      </div>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">{data.course.title}</h1>
        <p className="text-slate-600 mb-8">
          Work through the units below at your own pace. Sign in to track your progress.
        </p>

        {data.units.map((unit, i) => (
          <UnitSection key={i} unit={unit} courseSlug={data.course.slug} />
        ))}
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-200 mt-auto">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} Lens Academy. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}

export function renderCourseOverview(data: CourseData): string {
  return renderToStaticMarkup(<CourseOverviewPage data={data} />);
}
```

**Step 4: Add course page to prerender script**

Modify `web_frontend/scripts/prerender.ts`:

```typescript
// Add imports at top
import { renderCourseOverview } from "./pages/course.js";
import { loadCourseData } from "./load-course-data.js";

// Add to pages array:
const courseData = loadCourseData("default");

const pages: PageConfig[] = [
  {
    path: "/",
    outputFile: "index.html",
    title: "Lens Academy | AI Safety Course",
    description: "A free, high quality course on AI existential risk. No gatekeeping, no application process.",
    render: renderLandingPage,
  },
  {
    path: "/course",
    outputFile: "course/index.html",
    title: `${courseData.course.title} | Lens Academy`,
    description: "Learn about AI existential risk through videos, articles, and guided discussions.",
    render: () => renderCourseOverview(courseData),
  },
];
```

**Step 5: Build and verify**

```bash
cd web_frontend && npm run build
```

Check output:

```bash
head -100 web_frontend/dist/course/index.html
```

Expected: Full HTML with course units and lessons listed.

**Step 6: Commit**

```bash
jj new -m "feat: pre-render course overview page"
```

---

## Task 4: Update FastAPI to Serve Pre-rendered Pages

**Files:**
- Modify: `main.py`

**Step 1: Update the root route**

The root route currently serves `static/landing.html`. Update it to serve the pre-rendered `dist/index.html` in production:

In `main.py`, modify the `root()` function:

```python
@app.get("/")
async def root():
    """Serve pre-rendered landing page."""
    if is_dev_mode():
        return {
            "status": "ok",
            "message": "API-only mode. Access frontend at Vite dev server.",
            "bot_ready": bot.is_ready() if bot else False,
        }
    # Serve pre-rendered landing page from dist/
    landing_file = spa_path / "index.html"
    if landing_file.exists():
        return FileResponse(landing_file)
    # Fallback to static landing if dist doesn't exist
    static_landing = static_path / "landing.html"
    if static_landing.exists():
        return FileResponse(static_landing)
    return {"status": "ok", "bot_ready": bot.is_ready() if bot else False}
```

**Step 2: Add explicit route for /course**

Add a new route to serve the pre-rendered course page before the SPA catch-all:

```python
@app.get("/course")
@app.get("/course/")
async def course_overview():
    """Serve pre-rendered course overview page."""
    if is_dev_mode():
        # In dev mode, proxy to Vite
        return RedirectResponse(f"http://localhost:{os.getenv('VITE_PORT', '5173')}/course")
    course_file = spa_path / "course" / "index.html"
    if course_file.exists():
        return FileResponse(course_file)
    # Fallback to SPA
    return FileResponse(spa_path / "index.html")
```

Add the import at the top:

```python
from fastapi.responses import FileResponse, RedirectResponse
```

**Step 3: Test locally**

Build and run:

```bash
cd web_frontend && npm run build
cd .. && python main.py --no-bot
```

Visit:
- http://localhost:8000/ - Should show landing page with proper meta tags
- http://localhost:8000/course - Should show course overview
- View source to confirm HTML content is present (not empty div)

**Step 4: Commit**

```bash
jj new -m "feat: serve pre-rendered pages from FastAPI"
```

---

## Task 5: Clean Up Old Static Landing Page

**Files:**
- Delete: `web_frontend/static/landing.html`
- Modify: `web_frontend/vite.config.ts` (remove serveLandingPage plugin)

**Step 1: Delete the old static landing page**

```bash
rm web_frontend/static/landing.html
```

**Step 2: Remove the Vite plugin**

In `web_frontend/vite.config.ts`, remove the `serveLandingPage` plugin:

```typescript
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = process.env.API_PORT || "8000";

// Auto-version from Railway git SHA, or 'dev' for local development
const appVersion = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || "dev";

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/auth": `http://localhost:${apiPort}`,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

**Step 3: Update the React Home component**

The `Home.tsx` error page is no longer needed since `/` now serves pre-rendered HTML. But we still need a route for client-side navigation. Update it to redirect:

In `web_frontend/src/pages/Home.tsx`:

```tsx
import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    // If user navigated here via React Router, do a hard navigation
    // to get the pre-rendered landing page
    window.location.href = "/";
  }, []);

  return null;
}
```

**Step 4: Test dev mode still works**

```bash
python main.py --dev --no-bot
```

Visit http://localhost:5173/ - Vite should serve the SPA (with the redirect).

**Step 5: Commit**

```bash
jj new -m "chore: remove old static landing page, clean up Vite config"
```

---

## Task 6: Add CSS to Pre-rendered Pages

**Files:**
- Modify: `web_frontend/scripts/prerender.ts`

**Step 1: Extract CSS filename from Vite manifest**

Vite generates hashed filenames. We need to read the manifest to get the actual CSS filename.

Update `web_frontend/scripts/prerender.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

// ... existing code ...

interface ViteManifest {
  [key: string]: {
    file: string;
    css?: string[];
  };
}

function getCssFiles(): string[] {
  const manifestPath = join(DIST_DIR, ".vite", "manifest.json");
  if (!existsSync(manifestPath)) {
    console.warn("Warning: Vite manifest not found, using default CSS path");
    return ["/assets/index.css"];
  }

  const manifest: ViteManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const cssFiles: string[] = [];

  for (const entry of Object.values(manifest)) {
    if (entry.css) {
      cssFiles.push(...entry.css.map((f) => `/${f}`));
    }
  }

  return [...new Set(cssFiles)]; // Dedupe
}

function generateHtml(page: PageConfig): string {
  const content = page.render();
  const cssFiles = getCssFiles();
  const cssLinks = cssFiles.map((f) => `<link rel="stylesheet" href="${f}">`).join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${page.title}</title>
    <meta name="description" content="${page.description}" />

    <!-- Open Graph -->
    <meta property="og:title" content="${page.title}" />
    <meta property="og:description" content="${page.description}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://lensacademy.ai${page.path}" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${page.title}" />
    <meta name="twitter:description" content="${page.description}" />

    <!-- Favicon -->
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="manifest" href="/site.webmanifest">

    <!-- Styles from Vite build -->
    ${cssLinks}
  </head>
  <body class="bg-stone-50 text-slate-900 antialiased">
    ${content}
  </body>
</html>`;
}
```

**Step 2: Enable manifest generation in Vite**

Update `web_frontend/vite.config.ts` to generate manifest:

```typescript
export default defineConfig({
  build: {
    manifest: true,
  },
  // ... rest of config
});
```

**Step 3: Rebuild and verify**

```bash
cd web_frontend && npm run build
```

Check that CSS is properly linked:

```bash
grep "stylesheet" web_frontend/dist/index.html
```

Expected: `<link rel="stylesheet" href="/assets/index-[hash].css">`

**Step 4: Commit**

```bash
jj new -m "fix: use Vite manifest for CSS paths in pre-rendered pages"
```

---

## Summary

After completing all tasks:

1. **Landing page** (`/`) - Pre-rendered from React with proper meta tags
2. **Course overview** (`/course`) - Pre-rendered with lesson list, no user progress
3. **Other pages** - Still SPA, served by FastAPI catch-all

**SEO benefits:**
- Social media previews work (Twitter, Slack, Discord)
- Search engines see content immediately
- Fast initial paint for landing and course pages

**What stays the same:**
- Lesson pages remain SPA (interactive, don't need SEO)
- Auth flow unchanged
- API routes unchanged
- Discord bot unchanged
