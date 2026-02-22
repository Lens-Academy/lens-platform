// web_frontend/src/test/fetchMock.ts
import { vi } from "vitest";

const originalFetch = global.fetch;

/**
 * Reusable fetch mock for unit+1 tests.
 *
 * Usage:
 *   const fm = createFetchMock();
 *   beforeEach(() => fm.install());
 *   afterEach(() => fm.restore());
 *
 *   fm.mock.mockResolvedValueOnce(jsonResponse({ data: 1 }));
 *   fm.mock.mockImplementation((input) => {
 *     if (String(input).includes("/auth/me")) return Promise.resolve(jsonResponse({...}));
 *     return Promise.resolve(errorResponse(404));
 *   });
 */
export function createFetchMock() {
  const mock = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >();

  return {
    mock,
    install() {
      global.fetch = mock as unknown as typeof fetch;
    },
    restore() {
      global.fetch = originalFetch;
      mock.mockReset();
    },
    /** Filter mock.calls to those whose URL contains the substring */
    callsTo(urlSubstring: string) {
      return mock.mock.calls.filter(([input]) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.includes(urlSubstring);
      });
    },
  };
}

/** Create a Response with JSON body */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Create an error Response (no body) */
export function errorResponse(status: number): Response {
  return new Response(null, { status });
}
