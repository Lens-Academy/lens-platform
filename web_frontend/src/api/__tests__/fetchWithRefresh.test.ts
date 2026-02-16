// web_frontend/src/api/__tests__/fetchWithRefresh.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createFetchMock,
  jsonResponse,
  errorResponse,
} from "@/test/fetchMock";
import { fetchWithRefresh } from "../fetchWithRefresh";

const fm = createFetchMock();

beforeEach(() => fm.install());
afterEach(() => fm.restore());

describe("fetchWithRefresh", () => {
  it("passes through non-401 responses", async () => {
    fm.mock.mockResolvedValue(jsonResponse({ data: "ok" }));

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "ok" });
    expect(fm.mock).toHaveBeenCalledTimes(1);
  });

  it("retries after successful token refresh on 401", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // refresh
      .mockResolvedValueOnce(jsonResponse({ data: "ok" })); // retry

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "ok" });
    expect(fm.mock).toHaveBeenCalledTimes(3);
    expect(fm.callsTo("/auth/refresh")).toHaveLength(1);
  });

  it("returns original 401 when refresh fails", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // original
      .mockResolvedValueOnce(errorResponse(403)); // refresh fails

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(401);
    expect(fm.mock).toHaveBeenCalledTimes(2);
  });

  it("returns original 401 when refresh throws network error", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401))
      .mockRejectedValueOnce(new Error("Network error"));

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(401);
  });

  it("deduplicates concurrent 401 refreshes", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401)) // call A original
      .mockResolvedValueOnce(errorResponse(401)) // call B original
      .mockResolvedValueOnce(jsonResponse({ ok: true })) // single refresh
      .mockResolvedValueOnce(jsonResponse({ a: 1 })) // call A retry
      .mockResolvedValueOnce(jsonResponse({ b: 2 })); // call B retry

    const [resA, resB] = await Promise.all([
      fetchWithRefresh("/api/a"),
      fetchWithRefresh("/api/b"),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(fm.callsTo("/auth/refresh")).toHaveLength(1);
    expect(fm.mock).toHaveBeenCalledTimes(5);
  });

  it("passes through non-401 errors unchanged", async () => {
    fm.mock.mockResolvedValue(errorResponse(500));

    const res = await fetchWithRefresh("/api/test");

    expect(res.status).toBe(500);
    expect(fm.mock).toHaveBeenCalledTimes(1);
  });

  it("preserves request options on retry", async () => {
    fm.mock
      .mockResolvedValueOnce(errorResponse(401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await fetchWithRefresh("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "value" }),
    });

    const retryCall = fm.mock.mock.calls[2];
    expect(retryCall[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  });
});
