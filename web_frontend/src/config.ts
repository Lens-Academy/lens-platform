// Centralized configuration for the web frontend

// In production (single service), use relative URLs (empty string)
// In development, derive API port from frontend port (3002 → 8002)
// Frontend runs on 3000+N, API runs on 8000+N
const getDevApiUrl = () => {
  if (typeof window === "undefined") return "http://localhost:8000";
  const frontendPort = parseInt(window.location.port, 10) || 3000;
  const apiPort = frontendPort + 5000; // 3000→8000, 3001→8001, 3002→8002
  return `http://localhost:${apiPort}`;
};

export const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? getDevApiUrl() : "");

// Discord invite link for joining the course server
// NOTE: Also defined in:
//   - core/notifications/urls.py (backend emails)
//   - web_frontend/static/landing.html (static landing page)
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
