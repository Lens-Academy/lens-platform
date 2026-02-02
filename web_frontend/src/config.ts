// Centralized configuration for the web frontend

// Use relative URLs everywhere - Vite proxy handles dev, same-origin handles prod
// Override with VITE_API_URL env var if needed for special cases
export const API_URL = import.meta.env.VITE_API_URL ?? "";

// Discord invite link for joining the course server
// NOTE: Also defined in:
//   - core/notifications/urls.py (backend emails)
//   - web_frontend/static/landing.html (static landing page)
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
