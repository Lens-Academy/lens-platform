// Centralized configuration for the web frontend

// API_URL: Empty string for same-origin requests, or set VITE_API_URL for dev mode
export const API_URL = import.meta.env.VITE_API_URL ?? "";

// Discord invite link for joining the course server
// NOTE: Also defined in:
//   - core/notifications/urls.py (backend emails)
//   - web_frontend/static/landing.html (static landing page)
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
