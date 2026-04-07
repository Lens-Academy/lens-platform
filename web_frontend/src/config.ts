// Centralized configuration for the web frontend

// Use relative URLs everywhere - Vite proxy handles dev, same-origin handles prod
// Override with VITE_API_URL env var if needed for special cases
export const API_URL = import.meta.env.VITE_API_URL ?? "";

// Lens Editor integration
export const LENS_EDITOR_BASE_URL = "https://editor.lensacademy.org";
const LENS_EDITOR_EDU_CONTENT_SUGGEST_TOKEN =
  import.meta.env.VITE_LENS_EDITOR_EDU_CONTENT_SUGGEST_TOKEN ?? "";

export function lensEditorUrl(sourcePath: string): string {
  const base = `${LENS_EDITOR_BASE_URL}/open/Lens%20Edu/${sourcePath}`;
  return LENS_EDITOR_EDU_CONTENT_SUGGEST_TOKEN
    ? `${base}?t=${LENS_EDITOR_EDU_CONTENT_SUGGEST_TOKEN}`
    : base;
}

// Discord invite link for joining the course server
// NOTE: Also defined in:
//   - core/notifications/urls.py (backend emails)
//   - web_frontend/static/landing.html (static landing page)
export const DISCORD_INVITE_URL = "https://discord.gg/nn7HrjFZ8E";
