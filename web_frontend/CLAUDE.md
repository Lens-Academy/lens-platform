# Web Frontend

Vike (v0.4) + Vite (v7) + React 19 + Tailwind CSS v4. Uses partial SSG prerendering with SPA fallback.

## Commands

```bash
npm run dev      # Vite dev server (hot reload)
npm run build    # Production build
npm run preview  # Preview production build locally
npm run lint     # ESLint
```

## Directory Structure

```
src/
├── pages/          # Vike route pages
├── components/     # React components
├── hooks/          # Custom React hooks
├── api/            # API client functions
├── lib/            # Utility libraries
├── utils/          # Helper utilities
├── views/          # View components (page layouts)
├── types/          # TypeScript types
├── styles/         # CSS/styling
├── analytics.ts    # PostHog analytics
├── config.ts       # Configuration
├── errorTracking.ts # Sentry integration
└── geolocation.ts  # Geolocation utilities
```

## Vike Routing

Pages are file-based routes in `src/pages/`:

```
src/pages/
├── index/
│   └── +Page.tsx       # /
├── about/
│   └── +Page.tsx       # /about
├── course/
│   └── @id/
│       └── +Page.tsx   # /course/:id (dynamic)
```

**Page component:**

```tsx
// src/pages/my-page/+Page.tsx
export default function Page() {
  return <div>My Page</div>;
}
```

**With data loading:**

```tsx
// src/pages/my-page/+data.ts
export async function data() {
  const items = await fetchItems();
  return { items };
}

// src/pages/my-page/+Page.tsx
import { useData } from "vike-react/useData";

export default function Page() {
  const { items } = useData();
  return (
    <ul>
      {items.map((i) => (
        <li key={i.id}>{i.name}</li>
      ))}
    </ul>
  );
}
```

## UI/UX Patterns

**Never use `cursor-not-allowed`** - use `cursor-default` instead for non-interactive elements. The not-allowed cursor is visually aggressive; a default cursor with lack of hover feedback is sufficient.

**Tailwind CSS v4** - uses the new CSS-first configuration. Styles are in `src/styles/`.

## API Client

API calls go through `src/api/`:

```tsx
// src/api/users.ts
export async function getProfile() {
  const res = await fetch("/api/users/me", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

// In component
import { getProfile } from "../api/users";

const profile = await getProfile();
```

## Production Build

The built frontend (`dist/`) is served by FastAPI in production. The build uses partial SSG - some pages are pre-rendered at build time, others are client-side rendered.

```bash
npm run build   # Creates dist/
```

FastAPI serves `dist/client/` as static files with SPA catchall routing.

## Integrations

- **Sentry** (`errorTracking.ts`) - Frontend error tracking
- **PostHog** (`analytics.ts`) - Product analytics
- **React Markdown** - Rendering markdown content
