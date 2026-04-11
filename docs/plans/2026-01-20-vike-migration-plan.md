# Vike Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the web frontend from Next.js to Vike for lower RAM/CPU usage during development.

**Architecture:** Vite + Vike replaces Next.js. Express server in production serves Vike pages and proxies `/api/*` to FastAPI. SSG for landing and course overview pages, SPA for everything else.

**Tech Stack:** Vike, vike-react, Vite, Express, http-proxy-middleware, React 19, Tailwind 4, TypeScript

---

## Task 1: Update Dependencies

**Files:**
- Modify: `web_frontend/package.json`

**Step 1: Remove Next.js dependencies**

Run:
```bash
cd web_frontend && npm uninstall next @sentry/nextjs eslint-config-next
```

**Step 2: Install Vike and related packages**

Run:
```bash
npm install vike vike-react vite express @sentry/react @vitejs/plugin-react
```

**Step 3: Install dev dependencies**

Run:
```bash
npm install -D @sentry/vite-plugin @types/express http-proxy-middleware sirv tsx
```

**Step 4: Update package.json scripts**

Replace the scripts section with:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "start": "tsx server/index.ts",
    "lint": "eslint"
  }
}
```

**Step 5: Update package name**

Change `"name": "web_frontend_next"` to `"name": "web_frontend"`.

**Step 6: Verify package.json is valid**

Run:
```bash
cat package.json | head -20
```

**Step 7: Commit**

```bash
jj desc -m "chore: replace Next.js with Vike dependencies"
```

---

## Task 2: Create Vite Configuration

**Files:**
- Create: `web_frontend/vite.config.ts`

**Step 1: Create vite.config.ts**

Create `web_frontend/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import vike from "vike/plugin";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    vike({
      prerender: true,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
```

**Step 2: Verify file was created**

Run:
```bash
cat web_frontend/vite.config.ts
```

**Step 3: Commit**

```bash
jj desc -m "chore: add Vite configuration with API proxy"
```

---

## Task 3: Update TypeScript Configuration

**Files:**
- Modify: `web_frontend/tsconfig.json`

**Step 1: Update tsconfig.json**

Replace contents of `web_frontend/tsconfig.json` with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "server", "vite.config.ts"],
  "exclude": ["node_modules"]
}
```

**Step 2: Verify changes**

Run:
```bash
cat web_frontend/tsconfig.json
```

**Step 3: Commit**

```bash
jj desc -m "chore: update tsconfig for Vite"
```

---

## Task 4: Update ESLint Configuration

**Files:**
- Modify: `web_frontend/eslint.config.mjs`

**Step 1: Update eslint.config.mjs**

Replace contents of `web_frontend/eslint.config.mjs` with:
```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    ignores: ["node_modules", "dist", ".vite"],
  },
];
```

**Step 2: Install ESLint plugins**

Run:
```bash
npm install -D eslint-plugin-react eslint-plugin-react-hooks
```

**Step 3: Verify lint works**

Run:
```bash
npm run lint -- --max-warnings=0 || echo "Lint errors expected - will fix later"
```

**Step 4: Commit**

```bash
jj desc -m "chore: update ESLint config for Vike"
```

---

## Task 5: Create Vike Global Configuration

**Files:**
- Create: `web_frontend/src/pages/+config.ts`

**Step 1: Create pages directory**

Run:
```bash
mkdir -p web_frontend/src/pages
```

**Step 2: Create +config.ts**

Create `web_frontend/src/pages/+config.ts`:
```typescript
import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  extends: vikeReact,
} satisfies Config;
```

**Step 3: Verify file**

Run:
```bash
cat web_frontend/src/pages/+config.ts
```

**Step 4: Commit**

```bash
jj desc -m "feat: add Vike global configuration"
```

---

## Task 6: Create Root Layout

**Files:**
- Create: `web_frontend/src/pages/+Layout.tsx`

**Step 1: Create +Layout.tsx**

Create `web_frontend/src/pages/+Layout.tsx`:
```tsx
import "../app/globals.css";
import { Providers } from "@/components/Providers";
import { GlobalComponents } from "@/components/GlobalComponents";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      {children}
      <GlobalComponents />
    </Providers>
  );
}
```

**Step 2: Verify file**

Run:
```bash
cat web_frontend/src/pages/+Layout.tsx
```

**Step 3: Commit**

```bash
jj desc -m "feat: add Vike root layout"
```

---

## Task 7: Create Head Component

**Files:**
- Create: `web_frontend/src/pages/+Head.tsx`

**Step 1: Create +Head.tsx**

Create `web_frontend/src/pages/+Head.tsx`:
```tsx
export default function Head() {
  return (
    <>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="icon" href="/favicon.ico" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <title>Lens Academy | AI Safety Course</title>
      <meta
        name="description"
        content="A free, high quality course on AI existential risk. No gatekeeping, no application process."
      />
    </>
  );
}
```

**Step 2: Verify file**

Run:
```bash
cat web_frontend/src/pages/+Head.tsx
```

**Step 3: Commit**

```bash
jj desc -m "feat: add Vike head component with fonts and meta"
```

---

## Task 8: Create Landing Page (SSG)

**Files:**
- Create: `web_frontend/src/pages/index/+Page.tsx`
- Create: `web_frontend/src/pages/index/+config.ts`

**Step 1: Create index directory**

Run:
```bash
mkdir -p web_frontend/src/pages/index
```

**Step 2: Create +config.ts for SSG**

Create `web_frontend/src/pages/index/+config.ts`:
```typescript
export default {
  prerender: true,
};
```

**Step 3: Create +Page.tsx**

Create `web_frontend/src/pages/index/+Page.tsx`:
```tsx
import Home from "@/views/Home";

export default function LandingPage() {
  return <Home />;
}
```

**Step 4: Verify files**

Run:
```bash
ls -la web_frontend/src/pages/index/
```

**Step 5: Commit**

```bash
jj desc -m "feat: add landing page with SSG"
```

---

## Task 9: Create Course Overview Page (SSG)

**Files:**
- Create: `web_frontend/src/pages/course/+Page.tsx`
- Create: `web_frontend/src/pages/course/+config.ts`
- Create: `web_frontend/src/pages/course/@courseId/+Page.tsx`
- Create: `web_frontend/src/pages/course/@courseId/+config.ts`
- Create: `web_frontend/src/pages/course/@courseId/+onBeforePrerenderStart.ts`

**Step 1: Create directories**

Run:
```bash
mkdir -p web_frontend/src/pages/course/@courseId
```

**Step 2: Create /course +config.ts**

Create `web_frontend/src/pages/course/+config.ts`:
```typescript
export default {
  prerender: true,
};
```

**Step 3: Create /course +Page.tsx (redirects to default)**

Create `web_frontend/src/pages/course/+Page.tsx`:
```tsx
import CourseOverview from "@/views/CourseOverview";

export default function CoursePage() {
  return <CourseOverview courseId="default" />;
}
```

**Step 4: Create /course/@courseId +config.ts**

Create `web_frontend/src/pages/course/@courseId/+config.ts`:
```typescript
export default {
  prerender: true,
};
```

**Step 5: Create /course/@courseId +onBeforePrerenderStart.ts**

Create `web_frontend/src/pages/course/@courseId/+onBeforePrerenderStart.ts`:
```typescript
export function onBeforePrerenderStart() {
  // List all course IDs to prerender at build time
  return ["/course/default"];
}
```

**Step 6: Create /course/@courseId +Page.tsx**

Create `web_frontend/src/pages/course/@courseId/+Page.tsx`:
```tsx
import { usePageContext } from "vike-react/usePageContext";
import CourseOverview from "@/views/CourseOverview";

export default function CourseByIdPage() {
  const pageContext = usePageContext();
  const courseId = pageContext.routeParams?.courseId ?? "default";

  return <CourseOverview courseId={courseId} />;
}
```

**Step 7: Verify files**

Run:
```bash
find web_frontend/src/pages/course -type f
```

**Step 8: Commit**

```bash
jj desc -m "feat: add course overview pages with SSG"
```

---

## Task 10: Update Module View to Accept Props

**Files:**
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Read current Module.tsx to understand its interface**

Run:
```bash
head -50 web_frontend/src/views/Module.tsx
```

**Step 2: Update Module.tsx to accept courseId and moduleId as props**

The Module view needs to accept `courseId` and `moduleId` as props and handle its own data fetching internally.

At the top of the file, update or add the props interface:
```tsx
interface ModuleProps {
  courseId: string;
  moduleId: string;
}

export default function Module({ courseId, moduleId }: ModuleProps) {
```

Remove any `useParams()` calls from `next/navigation` and use the props instead.

**Step 3: Remove next/navigation import**

Remove:
```typescript
import { useParams } from "next/navigation";
```

**Step 4: Verify changes**

Run:
```bash
grep -n "useParams\|next/navigation" web_frontend/src/views/Module.tsx
```
Expected: No results

**Step 5: Commit**

```bash
jj desc -m "refactor: Module view receives courseId and moduleId as props"
```

---

## Task 11: Create Module Pages (SPA)

**Files:**
- Create: `web_frontend/src/pages/course/@courseId/module/@moduleId/+Page.tsx`
- Create: `web_frontend/src/pages/module/@moduleId/+Page.tsx`

**Step 1: Create directories**

Run:
```bash
mkdir -p web_frontend/src/pages/course/@courseId/module/@moduleId
mkdir -p web_frontend/src/pages/module/@moduleId
```

**Step 2: Create nested module page**

Create `web_frontend/src/pages/course/@courseId/module/@moduleId/+Page.tsx`:
```tsx
import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function CourseModulePage() {
  const pageContext = usePageContext();
  const courseId = pageContext.routeParams?.courseId ?? "default";
  const moduleId = pageContext.routeParams?.moduleId ?? "";

  return <Module courseId={courseId} moduleId={moduleId} />;
}
```

**Step 3: Create standalone module page**

Create `web_frontend/src/pages/module/@moduleId/+Page.tsx`:
```tsx
import { usePageContext } from "vike-react/usePageContext";
import Module from "@/views/Module";

export default function StandaloneModulePage() {
  const pageContext = usePageContext();
  const moduleId = pageContext.routeParams?.moduleId ?? "";

  return <Module courseId="default" moduleId={moduleId} />;
}
```

**Step 4: Verify files**

Run:
```bash
find web_frontend/src/pages -name "*module*" -type d
```

**Step 5: Commit**

```bash
jj desc -m "feat: add module pages (SPA)"
```

---

## Task 12: Create Remaining SPA Pages

**Files:**
- Create: `web_frontend/src/pages/signup/+Page.tsx`
- Create: `web_frontend/src/pages/auth/code/+Page.tsx`
- Create: `web_frontend/src/pages/availability/+Page.tsx`
- Create: `web_frontend/src/pages/facilitator/+Page.tsx`
- Create: `web_frontend/src/pages/privacy/+Page.tsx`
- Create: `web_frontend/src/pages/terms/+Page.tsx`

**Step 1: Create directories**

Run:
```bash
mkdir -p web_frontend/src/pages/signup
mkdir -p web_frontend/src/pages/auth/code
mkdir -p web_frontend/src/pages/availability
mkdir -p web_frontend/src/pages/facilitator
mkdir -p web_frontend/src/pages/privacy
mkdir -p web_frontend/src/pages/terms
```

**Step 2: Create signup page**

Create `web_frontend/src/pages/signup/+Page.tsx`:
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

**Step 3: Create auth/code page**

Create `web_frontend/src/pages/auth/code/+Page.tsx`:
```tsx
import Layout from "@/components/Layout";
import Auth from "@/views/Auth";

export default function AuthCodePage() {
  return (
    <Layout>
      <Auth />
    </Layout>
  );
}
```

**Step 4: Create availability page**

Create `web_frontend/src/pages/availability/+Page.tsx`:
```tsx
import Layout from "@/components/Layout";
import Availability from "@/views/Availability";

export default function AvailabilityPage() {
  return (
    <Layout>
      <Availability />
    </Layout>
  );
}
```

**Step 5: Create facilitator page**

Create `web_frontend/src/pages/facilitator/+Page.tsx`:
```tsx
import Layout from "@/components/Layout";
import Facilitator from "@/views/Facilitator";

export default function FacilitatorPage() {
  return (
    <Layout>
      <Facilitator />
    </Layout>
  );
}
```

**Step 6: Create privacy page**

Create `web_frontend/src/pages/privacy/+Page.tsx`:
```tsx
import Layout from "@/components/Layout";
import Privacy from "@/views/Privacy";

export default function PrivacyPage() {
  return (
    <Layout>
      <Privacy />
    </Layout>
  );
}
```

**Step 7: Create terms page**

Create `web_frontend/src/pages/terms/+Page.tsx`:
```tsx
import Layout from "@/components/Layout";
import Terms from "@/views/Terms";

export default function TermsPage() {
  return (
    <Layout>
      <Terms />
    </Layout>
  );
}
```

**Step 8: Verify files**

Run:
```bash
find web_frontend/src/pages -name "+Page.tsx" | wc -l
```
Expected: 11 (or more) page files

**Step 9: Commit**

```bash
jj desc -m "feat: add remaining SPA pages"
```

---

## Task 13: Create 404 Error Page

**Files:**
- Create: `web_frontend/src/pages/_error/+Page.tsx`

**Step 1: Create directory**

Run:
```bash
mkdir -p web_frontend/src/pages/_error
```

**Step 2: Create error page**

Create `web_frontend/src/pages/_error/+Page.tsx`:
```tsx
export default function ErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-slate-300 mb-4">404</h1>
        <p className="text-xl text-slate-600 mb-8">Page not found</p>
        <a
          href="/"
          className="px-6 py-3 bg-emerald-500 text-white rounded-full font-medium hover:bg-emerald-600 transition-colors"
        >
          Go Home
        </a>
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
jj desc -m "feat: add 404 error page"
```

---

## Task 14: Update Providers Component

**Files:**
- Modify: `web_frontend/src/components/Providers.tsx`

**Step 1: Update Providers.tsx**

Replace contents of `web_frontend/src/components/Providers.tsx` with:
```tsx
import { useEffect } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { initPostHog, capturePageView, hasConsent } from "@/analytics";
import { initSentry } from "@/errorTracking";

export function Providers({ children }: { children: React.ReactNode }) {
  const pageContext = usePageContext();
  const pathname = pageContext?.urlPathname ?? "";

  // Add environment label prefix to document title
  useEffect(() => {
    const envLabel = import.meta.env.VITE_ENV_LABEL;
    if (!envLabel || typeof document === "undefined") return;

    const prefixTitle = () => {
      const currentTitle = document.title;
      if (currentTitle && !currentTitle.startsWith(`${envLabel} - `)) {
        document.title = `${envLabel} - ${currentTitle}`;
      }
    };

    prefixTitle();
    const timeoutId = setTimeout(prefixTitle, 100);

    const titleElement = document.querySelector("title");
    let observer: MutationObserver | null = null;
    if (titleElement) {
      observer = new MutationObserver(prefixTitle);
      observer.observe(titleElement, { childList: true, characterData: true, subtree: true });
    }

    return () => {
      clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [pathname]);

  // Initialize analytics if user previously consented
  useEffect(() => {
    if (hasConsent()) {
      initPostHog();
      initSentry();
    }
  }, []);

  // Track page views on route change
  useEffect(() => {
    if (pathname) {
      capturePageView(pathname);
    }
  }, [pathname]);

  return <>{children}</>;
}
```

**Step 2: Verify changes**

Run:
```bash
head -20 web_frontend/src/components/Providers.tsx
```

**Step 3: Commit**

```bash
jj desc -m "refactor: update Providers to use Vike pageContext"
```

---

## Task 15: Update Error Tracking (Sentry)

**Files:**
- Modify: `web_frontend/src/errorTracking.ts`

**Step 1: Update errorTracking.ts**

Replace contents of `web_frontend/src/errorTracking.ts` with:
```typescript
import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "unknown";

let initialized = false;

/**
 * Initialize Sentry (call after user consents)
 */
export function initSentry(): void {
  if (initialized || !SENTRY_DSN) {
    if (!SENTRY_DSN) {
      console.warn("[errorTracking] VITE_SENTRY_DSN not set, skipping Sentry init");
    }
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: `ai-safety-course@${APP_VERSION}`,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: true,
      }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });

  initialized = true;
}

export function isSentryInitialized(): boolean {
  return initialized;
}

export function identifySentryUser(
  userId: number,
  properties?: {
    discord_id?: string;
    discord_username?: string;
    email?: string | null;
  }
): void {
  if (!initialized) return;

  Sentry.setUser({
    id: String(userId),
    username: properties?.discord_username,
    email: properties?.email || undefined,
  });
}

export function resetSentryUser(): void {
  if (!initialized) return;
  Sentry.setUser(null);
}

export { Sentry };
```

**Step 2: Verify changes**

Run:
```bash
head -10 web_frontend/src/errorTracking.ts
```

**Step 3: Commit**

```bash
jj desc -m "refactor: update Sentry to use @sentry/react"
```

---

## Task 16: Update Auth View

**Files:**
- Modify: `web_frontend/src/views/Auth.tsx`

**Step 1: Update imports**

In `web_frontend/src/views/Auth.tsx`, replace:
```typescript
import { useSearchParams, useRouter } from "next/navigation";
```
With:
```typescript
import { usePageContext } from "vike-react/usePageContext";
import { navigate } from "vike/client/router";
```

**Step 2: Update hooks usage**

Replace:
```typescript
const searchParams = useSearchParams();
const router = useRouter();
```
With:
```typescript
const pageContext = usePageContext();
const searchParams = pageContext.urlParsed?.search || {};
```

**Step 3: Update param access**

Replace:
```typescript
const code = searchParams?.get("code") ?? null;
const next = searchParams?.get("next") ?? "/signup";
```
With:
```typescript
const code = (searchParams as Record<string, string>).code ?? null;
const next = (searchParams as Record<string, string>).next ?? "/signup";
```

**Step 4: Update navigation**

Replace:
```typescript
router.push(data.next || next);
```
With:
```typescript
navigate(data.next || next);
```

**Step 5: Remove "use client" directive**

Remove the line `"use client";` from the top of the file.

**Step 6: Update useEffect dependencies**

Remove `router` from the useEffect dependency array since we're using `navigate()` which doesn't need to be a dependency.

**Step 7: Verify changes**

Run:
```bash
grep -n "next/navigation\|useRouter\|useSearchParams" web_frontend/src/views/Auth.tsx
```
Expected: No results

**Step 8: Commit**

```bash
jj desc -m "refactor: update Auth view for Vike"
```

---

## Task 17: Update CourseOverview View

**Files:**
- Modify: `web_frontend/src/views/CourseOverview.tsx`

**Step 1: Update imports**

In `web_frontend/src/views/CourseOverview.tsx`, replace:
```typescript
import { useRouter } from "next/navigation";
import Link from "next/link";
```
With:
```typescript
import { navigate } from "vike/client/router";
```

**Step 2: Remove router hook**

Remove:
```typescript
const router = useRouter();
```

**Step 3: Update navigation call**

Replace:
```typescript
router.push(`/course/${courseId}/module/${selectedModule.slug}`);
```
With:
```typescript
navigate(`/course/${courseId}/module/${selectedModule.slug}`);
```

**Step 4: Replace Link with anchor tags**

Replace all `<Link href=...>` with `<a href=...>`.

For example, replace:
```tsx
<Link
  href="/course"
  className="..."
>
  Course
</Link>
```
With:
```tsx
<a
  href="/course"
  className="..."
>
  Course
</a>
```

**Step 5: Remove "use client" directive**

Remove the line `"use client";` from the top of the file.

**Step 6: Verify changes**

Run:
```bash
grep -n "next/navigation\|next/link\|useRouter" web_frontend/src/views/CourseOverview.tsx
```
Expected: No results

**Step 7: Commit**

```bash
jj desc -m "refactor: update CourseOverview for Vike"
```

---

## Task 18: Update Components Using next/link

**Files:**
- Modify: `web_frontend/src/components/Layout.tsx`
- Modify: `web_frontend/src/components/LandingNav.tsx`
- Modify: `web_frontend/src/components/module/ModuleCompleteModal.tsx`
- Modify: `web_frontend/src/views/Module.tsx`

**Step 1: Update Layout.tsx**

In `web_frontend/src/components/Layout.tsx`:
- Remove: `import Link from "next/link";`
- Change all `<Link href=...>` to `<a href=...>`
- Remove `"use client";` if present

**Step 2: Update LandingNav.tsx**

In `web_frontend/src/components/LandingNav.tsx`:
- Remove: `import Link from "next/link";`
- Change all `<Link href=...>` to `<a href=...>`
- Remove `"use client";` if present

**Step 3: Update ModuleCompleteModal.tsx**

In `web_frontend/src/components/module/ModuleCompleteModal.tsx`:
- Remove: `import Link from "next/link";`
- Change all `<Link href=...>` to `<a href=...>`
- Remove `"use client";` if present

**Step 4: Update Module.tsx**

In `web_frontend/src/views/Module.tsx`:
- Remove: `import Link from "next/link";`
- Change all `<Link href=...>` to `<a href=...>`
- Remove `"use client";` if present

**Step 5: Verify no next/link imports remain in components/views**

Run:
```bash
grep -r "next/link" web_frontend/src/components/ web_frontend/src/views/
```
Expected: No results

**Step 6: Commit**

```bash
jj desc -m "refactor: replace next/link with native anchor tags"
```

---

## Task 19: Remove "use client" Directives

**Files:**
- All files in `web_frontend/src/views/`
- All files in `web_frontend/src/components/`
- All files in `web_frontend/src/hooks/`

**Step 1: Find all files with "use client"**

Run:
```bash
grep -rl '"use client"' web_frontend/src/
```

**Step 2: Remove "use client" from all files**

For each file found, remove the `"use client";` line at the top.

Run:
```bash
find web_frontend/src -name "*.tsx" -o -name "*.ts" | xargs sed -i '/"use client";/d'
```

**Step 3: Verify removal**

Run:
```bash
grep -r '"use client"' web_frontend/src/
```
Expected: No results

**Step 4: Commit**

```bash
jj desc -m "chore: remove Next.js 'use client' directives"
```

---

## Task 20: Update Environment Variables

**Files:**
- Modify: `web_frontend/.env.example`
- Modify: `web_frontend/.env.local`
- Modify: `web_frontend/src/config.ts`
- Modify: `web_frontend/src/analytics.ts`

**Step 1: Update .env.example**

Replace contents of `web_frontend/.env.example` with:
```
# API URL for backend
VITE_API_URL=http://localhost:8000

# Environment label (shown in browser tab title for staging)
VITE_ENV_LABEL=

# Sentry DSN for error tracking
VITE_SENTRY_DSN=

# App version for Sentry releases
VITE_APP_VERSION=

# PostHog API key
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://app.posthog.com
```

**Step 2: Update .env.local**

Update `web_frontend/.env.local` to use `VITE_` prefix:
```
VITE_API_URL=http://localhost:8000
```

**Step 3: Update config.ts**

Replace `web_frontend/src/config.ts` contents with:
```typescript
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
```

**Step 4: Update analytics.ts**

In `web_frontend/src/analytics.ts`, replace all `process.env.NEXT_PUBLIC_*` with `import.meta.env.VITE_*`:
- `process.env.NEXT_PUBLIC_POSTHOG_KEY` → `import.meta.env.VITE_POSTHOG_KEY`
- `process.env.NEXT_PUBLIC_POSTHOG_HOST` → `import.meta.env.VITE_POSTHOG_HOST`

**Step 5: Verify no NEXT_PUBLIC_ references remain**

Run:
```bash
grep -r "NEXT_PUBLIC_" web_frontend/src/
```
Expected: No results

**Step 6: Commit**

```bash
jj desc -m "refactor: update env vars to use VITE_ prefix"
```

---

## Task 21: Create Express Production Server

**Files:**
- Create: `web_frontend/server/index.ts`

**Step 1: Create server directory**

Run:
```bash
mkdir -p web_frontend/server
```

**Step 2: Create server/index.ts**

Create `web_frontend/server/index.ts`:
```typescript
import express, { Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { renderPage } from "vike/server";
import sirv from "sirv";

const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 3000;
const apiUrl = process.env.API_URL || "http://localhost:8000";

async function startServer() {
  const app = express();

  // API proxy
  app.use(
    "/api",
    createProxyMiddleware({
      target: apiUrl,
      changeOrigin: true,
    })
  );

  if (isProduction) {
    // Serve pre-built static assets
    app.use(sirv("dist/client", { extensions: [] }));
  } else {
    // Use Vite dev server middleware
    const vite = await import("vite");
    const viteDevServer = await vite.createServer({
      server: { middlewareMode: true },
    });
    app.use(viteDevServer.middlewares);
  }

  // Vike middleware - handle all other routes
  app.get("*", async (req: Request, res: Response, next: NextFunction) => {
    const pageContext = await renderPage({ urlOriginal: req.originalUrl });
    const { httpResponse } = pageContext;

    if (!httpResponse) {
      return next();
    }

    const { statusCode, headers, earlyHints } = httpResponse;

    // Send early hints if supported
    if (res.writeEarlyHints && earlyHints) {
      res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) });
    }

    headers.forEach(([name, value]) => res.setHeader(name, value));
    res.status(statusCode);
    httpResponse.pipe(res);
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer();
```

**Step 3: Verify file**

Run:
```bash
cat web_frontend/server/index.ts
```

**Step 4: Commit**

```bash
jj desc -m "feat: add Express production server with API proxy"
```

---

## Task 22: Move globals.css

**Files:**
- Move: `web_frontend/src/app/globals.css` → `web_frontend/src/styles/globals.css`
- Update: `web_frontend/src/pages/+Layout.tsx`

**Step 1: Create styles directory and move file**

Run:
```bash
mkdir -p web_frontend/src/styles
mv web_frontend/src/app/globals.css web_frontend/src/styles/globals.css
```

**Step 2: Update Layout import**

In `web_frontend/src/pages/+Layout.tsx`, change:
```typescript
import "../app/globals.css";
```
To:
```typescript
import "../styles/globals.css";
```

**Step 3: Commit**

```bash
jj desc -m "refactor: move globals.css to styles directory"
```

---

## Task 23: Delete Next.js Files

**Files:**
- Delete: `web_frontend/src/app/` (entire directory)
- Delete: `web_frontend/src/lib/api-server.ts`
- Delete: `web_frontend/next.config.ts`
- Delete: `web_frontend/next-env.d.ts`
- Delete: `web_frontend/.next/` (build output)
- Delete: `web_frontend/.vercel/` (Vercel config)

**Step 1: Delete app directory**

Run:
```bash
rm -rf web_frontend/src/app
```

**Step 2: Delete lib/api-server.ts**

Run:
```bash
rm -f web_frontend/src/lib/api-server.ts
```

**Step 3: Delete Next.js config files**

Run:
```bash
rm -f web_frontend/next.config.ts web_frontend/next-env.d.ts
```

**Step 4: Delete .next build output**

Run:
```bash
rm -rf web_frontend/.next
```

**Step 5: Delete .vercel directory**

Run:
```bash
rm -rf web_frontend/.vercel
```

**Step 6: Verify deletions**

Run:
```bash
ls web_frontend/src/
```
Expected: `pages`, `views`, `components`, `hooks`, `types`, `styles`, etc. (no `app` directory)

**Step 7: Commit**

```bash
jj desc -m "chore: remove Next.js files"
```

---

## Task 24: Install Dependencies and Test Build

**Step 1: Remove node_modules and reinstall**

Run:
```bash
cd web_frontend && rm -rf node_modules package-lock.json && npm install
```

**Step 2: Check for TypeScript errors**

Run:
```bash
cd web_frontend && npx tsc --noEmit
```

Fix any type errors that appear.

**Step 3: Attempt build**

Run:
```bash
cd web_frontend && npm run build
```

**Step 4: If build succeeds, commit**

```bash
jj desc -m "chore: verify Vike build works"
```

---

## Task 25: Test Development Server

**Step 1: Start the dev server**

Run:
```bash
cd web_frontend && npm run dev
```

**Step 2: Open browser**

Navigate to http://localhost:3001 and verify:
- Landing page renders
- Navigation works
- No console errors

**Step 3: Test with FastAPI backend**

In another terminal:
```bash
python main.py --dev
```

Verify API proxy works by testing authenticated features:
- Visit /signup
- Visit /course

**Step 4: Final commit**

```bash
jj desc -m "feat: complete Vike migration"
```

---

## Post-Migration Checklist

- [ ] All pages render correctly
- [ ] Client-side navigation works (no full page reloads)
- [ ] API calls work (login, course data, etc.)
- [ ] SSG pages are pre-rendered (check dist/client/)
- [ ] Environment variables work in dev and build
- [ ] Sentry error tracking works
- [ ] PostHog analytics works
- [ ] Production server starts and serves correctly
- [ ] No "use client" directives remain
- [ ] No next/* imports remain

---

## Comparison with Next.js Version

After completing migration, use the `web_frontend_next_js_deprecated` folder to compare:

```bash
diff -r web_frontend/src/views web_frontend_next_js_deprecated/src/views
diff -r web_frontend/src/components web_frontend_next_js_deprecated/src/components
```

Review any differences to ensure no functionality was lost.
