# SSG + SPA Single Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert frontend to SSG for landing/course pages + SPA for module pages, served by Python backend as single service.

**Architecture:** Vike builds static HTML for SEO-critical pages (landing, course overview) at build time. Module pages use client-side rendering (SPA mode). Python/FastAPI serves all static files from `dist/client/`. No Node.js server at runtime.

**Tech Stack:** Vike, React, FastAPI, StaticFiles

---

## Background

**Current State:**
- Vike configured with `prerender: false` (disabled during debugging)
- Express server exists at `web_frontend/server/` (not needed)
- Python backend has SPA catch-all logic but expects `index.html` fallback
- Railway has separate frontend service (not needed)

**Target State:**
- SSG pages: `/`, `/course`, `/course/default` (pre-rendered HTML)
- SPA pages: `/course/*/module/*` (client-rendered, HTML shell)
- Single Railway service (Python backend serves everything)
- No Node.js/Express at runtime

**Key Insight:** Vike with `prerender: { partial: true }` keeps SSR files, but we don't want SSR. For pure SSG + SPA, we need:
- SSG pages: `prerender: true`
- SPA pages: `ssr: false` (disables server rendering, client-only)

---

## Task 1: Configure Vike for SSG + SPA Hybrid

**Files:**
- Modify: `web_frontend/vite.config.ts`
- Modify: `web_frontend/src/pages/+config.ts`
- Modify: `web_frontend/src/pages/index/+config.ts`
- Modify: `web_frontend/src/pages/course/+config.ts`
- Modify: `web_frontend/src/pages/course/@courseId/+config.ts`
- Create: `web_frontend/src/pages/course/@courseId/module/@moduleId/+config.ts`
- Create: `web_frontend/src/pages/module/@moduleId/+config.ts`

**Step 1: Update global Vike config to allow partial prerendering**

Edit `web_frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import vike from "vike/plugin";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    vike({
      prerender: {
        partial: true,
      },
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
        target: process.env.VITE_API_URL || "http://localhost:8001",
        changeOrigin: true,
      },
      "/auth": {
        target: process.env.VITE_API_URL || "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
  ssr: {
    noExternal: ["react-use"],
  },
});
```

**Step 2: Update global page config to default to SPA mode**

Edit `web_frontend/src/pages/+config.ts`:

```typescript
import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  extends: vikeReact,
  // Default: SPA mode (no server rendering)
  ssr: false,
} satisfies Config;
```

**Step 3: Enable SSG for landing page**

Edit `web_frontend/src/pages/index/+config.ts`:

```typescript
export default {
  prerender: true,
  ssr: true, // Need SSR for prerendering to work
};
```

**Step 4: Enable SSG for course list page**

Edit `web_frontend/src/pages/course/+config.ts`:

```typescript
export default {
  prerender: true,
  ssr: true,
};
```

**Step 5: Enable SSG for course detail pages**

Edit `web_frontend/src/pages/course/@courseId/+config.ts`:

```typescript
export default {
  prerender: true,
  ssr: true,
};
```

Note: The existing `+onBeforePrerenderStart.ts` already returns `["/course/default"]`.

**Step 6: Explicitly set SPA mode for module pages**

Create `web_frontend/src/pages/course/@courseId/module/@moduleId/+config.ts`:

```typescript
export default {
  prerender: false,
  ssr: false,
};
```

**Step 7: Set SPA mode for legacy module route**

Create `web_frontend/src/pages/module/@moduleId/+config.ts`:

```typescript
export default {
  prerender: false,
  ssr: false,
};
```

**Step 8: Verify build produces correct output**

Run: `cd web_frontend && rm -rf dist && npm run build`

Expected output should show:
- Pre-rendered HTML files in `dist/client/index/index.html`, `dist/client/course/index.html`, `dist/client/course/default/index.html`
- `dist/server/` directory WILL exist (Vike needs it for build-time SSR of SSG pages)
- `dist/client/` contains all static assets
- NO `200.html` yet (we'll create the SPA fallback in Task 5)

**Step 9: Commit**

```bash
jj describe -m "feat: configure Vike for SSG + SPA hybrid mode"
```

---

## Task 2: Remove Express Server (Not Needed)

**Files:**
- Delete: `web_frontend/server/index.ts`
- Delete: `web_frontend/server/tsconfig.json`
- Delete: `web_frontend/server/dist/` (if exists)
- Modify: `web_frontend/package.json`

**Step 1: Remove server directory**

```bash
rm -rf web_frontend/server/
```

**Step 2: Update package.json scripts**

Edit `web_frontend/package.json` scripts section:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint"
  }
}
```

Remove `start` script (not needed - Python serves the files).

**Step 3: Remove runtime dependencies only needed for Express server**

Edit `web_frontend/package.json` - remove from dependencies:
- `express`
- `http-proxy-middleware`
- `sirv`

And remove from devDependencies:
- `tsx`
- `@types/express`
- `@types/node` (if not needed elsewhere)

Run: `npm uninstall express http-proxy-middleware sirv tsx @types/express`

**Step 4: Commit**

```bash
jj describe -m "chore: remove Express server (Python serves static files)"
```

---

## Task 3: Remove Railway Frontend Service Config

**Files:**
- Delete: `web_frontend/railway.json`
- Delete: `web_frontend/nixpacks.toml` (if exists)

**Step 1: Remove Railway configs**

```bash
rm -f web_frontend/railway.json web_frontend/nixpacks.toml
```

**Step 2: Commit**

```bash
jj describe -m "chore: remove Railway frontend service config"
```

---

## Task 4: Update Python Backend to Serve Vike Output

**Files:**
- Modify: `main.py:254-322` (static file serving logic)

**Step 1: Update static file serving to handle SSG + SPA**

The current logic in `main.py` expects a single `index.html` fallback. For SSG + SPA, we need:
1. Try to serve exact file match (e.g., `/course/default/index.html`)
2. For SPA routes without pre-rendered HTML, serve a fallback HTML

Edit `main.py` - replace the SPA catch-all section (around lines 298-322):

```python
# Vike SSG + SPA static file serving (only in production, not dev mode)
if spa_path.exists() and not is_dev_mode():
    # Mount static assets from built frontend
    assets_path = spa_path / "client" / "assets"
    if assets_path.exists():
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def spa_catchall(full_path: str):
        """Serve Vike SSG pages or SPA fallback.

        For SSG pages: Serve pre-rendered HTML directly
        For SPA pages: Serve 200.html (Vike's SPA fallback) or index.html
        API routes (/api/*, /auth/*) are excluded - they 404 if no match.
        """
        # Don't catch API routes - let them 404 properly
        if full_path.startswith("api/") or full_path.startswith("auth/"):
            raise HTTPException(status_code=404, detail="Not found")

        client_path = spa_path / "client"

        # Try exact file match first (for static assets like favicon, images)
        static_file = client_path / full_path
        if static_file.exists() and static_file.is_file():
            return FileResponse(static_file)

        # Try SSG pre-rendered HTML (e.g., /course/default -> /course/default/index.html)
        # Handle both with and without trailing slash
        path_to_check = full_path.rstrip("/")
        if path_to_check == "":
            path_to_check = "index"

        ssg_file = client_path / path_to_check / "index.html"
        if ssg_file.exists():
            return FileResponse(ssg_file)

        # Check for direct .html file (e.g., /404 -> /404.html)
        direct_html = client_path / f"{path_to_check}.html"
        if direct_html.exists():
            return FileResponse(direct_html)

        # SPA fallback - serve 200/index.html (our pre-rendered SPA shell)
        # or root index.html if 200 doesn't exist
        spa_fallback = client_path / "200" / "index.html"
        if spa_fallback.exists():
            return FileResponse(spa_fallback)

        # Fallback to root index (SSG landing page as last resort)
        index_fallback = client_path / "index" / "index.html"
        if index_fallback.exists():
            return FileResponse(index_fallback)

        raise HTTPException(status_code=404, detail="Not found")
```

**Step 2: Update spa_path to point to correct location**

The `spa_path` is already set to `project_root / "web_frontend" / "dist"`. Vike outputs to `dist/client/`, so the logic above handles this by using `client_path = spa_path / "client"`.

**Step 3: Remove old static landing page logic**

The `static_path` for `landing.html` is no longer needed since the landing page will be SSG pre-rendered.

Edit `main.py` - update the root route (around lines 261-276):

```python
@app.get("/")
async def root():
    """Serve landing page or API status."""
    if is_dev_mode():
        return {
            "status": "ok",
            "message": "API-only mode. Run Vite frontend separately.",
            "bot_ready": bot.is_ready() if bot else False,
        }
    # In production, the catch-all route handles serving the SSG landing page
    # This route won't be reached due to catch-all, but keep for clarity
    landing_file = spa_path / "client" / "index" / "index.html"
    if landing_file.exists():
        return FileResponse(landing_file)
    return {"status": "ok", "bot_ready": bot.is_ready() if bot else False}
```

**Step 4: Test locally**

```bash
# Build frontend
cd web_frontend && npm run build && cd ..

# Run backend in production mode
python main.py --no-bot

# Test in browser:
# - http://localhost:8001/ (should show SSG landing page)
# - http://localhost:8001/course (should show SSG course page)
# - http://localhost:8001/course/default/module/introduction (should load SPA)
```

**Step 5: Commit**

```bash
jj describe -m "feat: update Python backend to serve Vike SSG + SPA output"
```

---

## Task 5: Create Vike SPA Fallback Page

**Files:**
- Create: `web_frontend/src/pages/_spa/+Page.tsx`
- Create: `web_frontend/src/pages/_spa/+config.ts`
- Create: `web_frontend/src/pages/_spa/+onBeforePrerenderStart.ts`

Vike does NOT auto-generate a `200.html` fallback for SPA routes. We need to create a dedicated SPA entry point that pre-renders a minimal HTML shell.

**How it works:**
1. User visits SPA route (e.g., `/course/default/module/intro`)
2. Python serves `200/index.html` (no SSG file for that path)
3. Browser loads HTML with Vike client scripts
4. Vike client router sees actual URL and renders the correct page component
5. The loading spinner is replaced with actual content

**Step 1: Create SPA fallback page component**

Create `web_frontend/src/pages/_spa/+Page.tsx`:

```tsx
// This page pre-renders to 200.html - the SPA fallback for non-SSG routes
// The actual page content will be rendered client-side by the route's +Page.tsx
export default function SpaFallbackPage() {
  return (
    <div id="spa-loading" className="flex items-center justify-center min-h-screen">
      <div className="animate-pulse text-gray-500">Loading...</div>
    </div>
  );
}
```

**Step 2: Configure SPA fallback to pre-render**

Create `web_frontend/src/pages/_spa/+config.ts`:

```typescript
export default {
  prerender: true,
  ssr: true,
};
```

**Step 3: Define the pre-render URL**

Create `web_frontend/src/pages/_spa/+onBeforePrerenderStart.ts`:

```typescript
// Pre-render this page to /200.html (SPA fallback convention)
export function onBeforePrerenderStart() {
  return ["/200"];
}
```

**Step 4: Verify 200.html is generated**

Run: `cd web_frontend && npm run build`

Check: `ls -la dist/client/200/index.html`

The Python backend will need to serve `dist/client/200/index.html` as the fallback. Update the fallback path in Task 4's Python code if needed.

**Step 5: Commit**

```bash
jj describe -m "feat: add SPA fallback page for client-side routing"
```

---

## Task 6: Clean Up Deprecated Files

**Files:**
- Delete: `web_frontend/static/landing.html` (if exists - SSG replaces this)
- Review: `web_frontend/.gitignore` - ensure `dist/` is listed

**Step 1: Remove old static landing page**

```bash
rm -f web_frontend/static/landing.html
rmdir web_frontend/static 2>/dev/null || true
```

**Step 2: Verify .gitignore has dist/**

Check `web_frontend/.gitignore` includes `/dist/`. It should already be there.

**Step 3: Commit**

```bash
jj describe -m "chore: remove deprecated static files"
```

---

## Task 7: Update Build Process for Railway

**Files:**
- Modify: `Dockerfile` (if needed)
- Or: Rely on Railway detecting Python + running build

**Step 1: Ensure frontend is built before deployment**

Railway needs to build the frontend before the Python server starts. Options:

**Option A: Add frontend build to Dockerfile**

If using Dockerfile, add npm build step:

```dockerfile
# Install Node.js for frontend build
RUN apt-get update && apt-get install -y nodejs npm

# Build frontend
WORKDIR /app/web_frontend
RUN npm ci && npm run build

# Back to app root
WORKDIR /app
```

**Option B: Use Railway build command**

Set build command in Railway dashboard or `railway.json` at root:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "buildCommand": "cd web_frontend && npm ci && npm run build"
  }
}
```

**Step 2: Verify the Python service config doesn't interfere**

Ensure the root `railway.json` (if exists) is for the Python backend, not the removed frontend service.

**Step 3: Commit**

```bash
jj describe -m "chore: configure Railway build for frontend"
```

---

## Task 8: Delete Railway Frontend Service

**Manual step in Railway Dashboard:**

1. Go to Railway dashboard
2. Navigate to staging environment
3. Delete the `lens-frontend` service
4. Keep only the backend service (which now serves frontend too)

No code changes needed.

---

## Task 9: End-to-End Testing

**Step 1: Test locally**

```bash
# Build frontend
cd web_frontend && npm run build && cd ..

# Start backend
python main.py --no-bot

# Test URLs:
# GET http://localhost:8001/ - Should return SSG HTML with content
# GET http://localhost:8001/course - Should return SSG HTML
# GET http://localhost:8001/course/default - Should return SSG HTML
# GET http://localhost:8001/course/default/module/introduction - Should return SPA shell
# GET http://localhost:8001/api/status - Should return JSON
```

**Step 2: Verify SSG pages have content in HTML**

```bash
curl -s http://localhost:8001/ | grep -o "Understand AI Safety" && echo "SSG working!"
curl -s http://localhost:8001/course | grep -o "AI Safety Course" && echo "SSG working!"
```

**Step 3: Verify SPA pages load correctly**

Open browser to `http://localhost:8001/course/default/module/introduction`.
- Page should load (may show loading state initially)
- React should hydrate and fetch module data from API
- Module content should display

**Step 4: Push and test on staging**

```bash
jj bookmark set staging -r @
jj git push --bookmark staging
```

Monitor Railway deploy logs, then test staging URLs.

---

## Summary

After completing all tasks:

1. **SSG Pages** (pre-rendered, good SEO):
   - `/` - Landing page
   - `/course` - Course list
   - `/course/default` - Course overview

2. **SPA Pages** (client-rendered):
   - `/course/*/module/*` - Module player
   - Other dynamic pages

3. **Single Service**:
   - Python backend serves static files + API
   - No Node.js at runtime
   - Simpler deployment

4. **Railway**:
   - One service (backend)
   - Frontend service deleted
   - Build command builds frontend first
