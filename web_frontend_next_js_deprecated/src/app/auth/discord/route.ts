import { NextRequest, NextResponse } from "next/server";

// Redirect to backend Discord OAuth
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const next = searchParams.get("next") || "/signup";

  // Get the origin (frontend URL) for the OAuth callback
  const origin = request.nextUrl.origin;

  // API URL from environment (server-side)
  const apiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;

  if (!apiUrl) {
    return NextResponse.json(
      { error: "API_URL not configured" },
      { status: 500 }
    );
  }

  // Redirect to backend OAuth endpoint
  const authUrl = new URL("/auth/discord", apiUrl);
  authUrl.searchParams.set("next", next);
  authUrl.searchParams.set("origin", origin);

  return NextResponse.redirect(authUrl.toString());
}
