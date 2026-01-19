import "@testing-library/jest-dom";
import { vi } from "vitest";

// Set base URL for relative fetch requests in jsdom
// This prevents "Failed to parse URL" errors with relative paths like /api/...
Object.defineProperty(window, "location", {
  value: new URL("http://localhost:3000"),
  writable: true,
});

// Mock fetch globally to prevent network requests in tests
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
  } as Response)
);

// Mock scrollIntoView which is not available in jsdom
Element.prototype.scrollIntoView = () => {};

// Mock ResizeObserver which is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
