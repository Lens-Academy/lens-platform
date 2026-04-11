# Vike Migration Design

## Goal

Migrate from Next.js to Vike for lower RAM/CPU usage during development while preserving all functionality.

## Architecture

### Production

```
                    ┌─────────────────────────────────────┐
                    │           Railway                    │
                    │                                      │
User ──────────────►│  Node/Express (:3000)               │
                    │  ├── /* → Vike (SSG/SPA pages)      │
                    │  └── /api/* → proxy ────────────────┼──► FastAPI (:8000)
                    │                                      │      └── PostgreSQL
                    │                                      │
                    └─────────────────────────────────────┘
```

### Development

```
Terminal 1: cd web_frontend && npm run dev     # Vite dev server (:3001)
Terminal 2: python main.py --dev               # FastAPI (:8000)
```

Vite proxies `/api/*` to FastAPI in dev mode.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build tool | Vite + Vike | Low RAM/CPU in dev |
| SSG pages | `/`, `/course/:courseId` | SEO for landing + course overview |
| SPA pages | Everything else | No SEO needed for app pages |
| Production server | Node/Express | Canonical Vike deployment |
| API routing | Frontend proxies `/api/*` | No CORS configuration needed |
| Auth redirect | Move to FastAPI | Remove frontend API route |

## Rendering Strategy

| Route | Rendering | Reason |
|-------|-----------|--------|
| `/` | SSG | SEO, rarely changes |
| `/course/:courseId` | SSG | SEO, rebuild on content change |
| `/course/:courseId/module/*` | SPA | Interactive, no SEO needed |
| `/signup`, `/auth/*`, etc. | SPA | User-specific, no SEO needed |

## File Structure

### Delete

- `src/app/` - entire directory (Next.js routing)
- `src/lib/api-server.ts` - Next.js server-side fetch helper
- `next.config.ts`
- `next-env.d.ts`

### Create

```
web_frontend/
├── src/
│   └── pages/                        # Vike routing
│       ├── +Layout.tsx               # Root layout
│       ├── +Head.tsx                 # <head> tags, fonts
│       ├── +config.ts                # Global config (React, client routing)
│       ├── index/+Page.tsx           # Landing page (SSG)
│       ├── course/@courseId/
│       │   ├── +Page.tsx             # Course overview (SSG)
│       │   ├── +config.ts            # SSG config
│       │   └── module/@moduleId/+Page.tsx  # Module viewer (SPA)
│       ├── signup/+Page.tsx
│       ├── auth/code/+Page.tsx
│       ├── availability/+Page.tsx
│       ├── facilitator/+Page.tsx
│       ├── privacy/+Page.tsx
│       ├── terms/+Page.tsx
│       └── module/@moduleId/+Page.tsx
├── server/
│   └── index.ts                      # Express: Vike + API proxy (~50 lines)
└── vite.config.ts                    # Vite + Vike config, dev proxy
```

### Keep (unchanged)

- `src/views/` - all view components
- `src/components/` - all components (minor Link updates)
- `src/hooks/` - all hooks (minor router updates)
- `src/types/` - all types
- `src/analytics.ts`
- `src/config.ts`
- `src/geolocation.ts`

## Code Changes

### Import Updates

| File pattern | Change |
|--------------|--------|
| `next/link` imports | `<Link href>` → `<a href>` |
| `next/navigation` imports | `usePathname`/`useParams` → Vike's `usePageContext()` |
| `@sentry/nextjs` | → `@sentry/react` |

### Views Receiving Route Params

Views currently using `useParams()` will receive params as props from `+Page.tsx`:

```tsx
// src/pages/course/@courseId/+Page.tsx
import CourseOverview from "@/views/CourseOverview";

export default function Page({ courseId }: { courseId: string }) {
  return <CourseOverview courseId={courseId} />;
}
```

### Auth Redirect

Frontend links point directly to FastAPI:

```typescript
// src/lib/auth.ts
export function getDiscordAuthUrl(next: string = "/signup") {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${import.meta.env.VITE_API_URL}/auth/discord?next=${next}&origin=${origin}`;
}
```

## Dependencies

### Remove

```
next
@sentry/nextjs
eslint-config-next
```

### Add (install latest)

```
vike
vike-react
vite
express
http-proxy-middleware
@sentry/react
@sentry/vite-plugin
```

### Keep

All other dependencies unchanged (React, Tailwind, etc.)

## Scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "start": "node server/index.js",
  "lint": "eslint"
}
```

## Future Considerations

- **Mobile app:** Architecture supports it - mobile calls FastAPI directly, no CORS issues (native apps don't have CORS)
- **SSR upgrade:** Any SPA page can be switched to SSR by changing its `+config.ts` - no architectural changes needed
