// Centralized configuration for the web frontend

// In production (single service), use relative URLs (empty string)
// In development, use VITE_API_URL or default to localhost:8001
export const API_URL = import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "http://localhost:8001" : "");

// Discord invite link for joining the course server
// NOTE: Also defined in:
//   - core/notifications/urls.py (backend emails)
//   - web_frontend/static/landing.html (static landing page)
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
