// web_frontend/src/geolocation.ts

// GDPR regions: EU (27) + EEA (3) + UK + Switzerland + Brazil (LGPD)
const GDPR_COUNTRIES = [
  // EU Member States
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  // EEA (not in EU)
  "IS",
  "LI",
  "NO",
  // UK GDPR
  "GB",
  "UK",
  // Switzerland
  "CH",
  // Brazil LGPD
  "BR",
];

interface GeolocationResponse {
  country: string;
}

/**
 * Detect user's country using ipapi.co (free tier: 30K requests/month)
 */
export async function detectUserCountry(): Promise<string | null> {
  try {
    const response = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    if (!response.ok) {
      console.warn("[geolocation] API error:", response.status);
      return null;
    }
    const data: GeolocationResponse = await response.json();
    return data.country || null;
  } catch (error) {
    console.warn("[geolocation] Failed to detect country:", error);
    return null;
  }
}

/**
 * Check if a country requires GDPR cookie consent
 */
export function requiresCookieConsent(countryCode: string | null): boolean {
  // If detection failed, show banner to be safe
  if (!countryCode) return true;
  return GDPR_COUNTRIES.includes(countryCode.toUpperCase());
}
