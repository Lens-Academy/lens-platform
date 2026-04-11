/**
 * Contract tests for CourseOverview component.
 *
 * These tests verify the frontend can render the shared fixture.
 * The same fixture is used by backend tests to verify API output.
 *
 * If this test fails, either:
 * 1. The fixture format changed (update frontend to match)
 * 2. The component has a rendering bug
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock Vike's router before importing components
vi.mock("vike/client/router", () => ({
  navigate: vi.fn(),
}));

// Import the shared fixture
import courseProgressFixture from "../../../fixtures/course_progress_response.json";

// Import the component under test
import CourseOverview from "@/views/CourseOverview";

// Mock fetch to handle both auth and API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Default mock responses
const mockAuthResponse = { ok: false }; // Not logged in
const mockCourseResponse = (data: unknown) => ({
  ok: true,
  json: async () => data,
});

describe("CourseOverview Contract Tests", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Set up default mocks: auth fails (not logged in), course returns fixture
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/users/me")) {
        return Promise.resolve(mockAuthResponse);
      }
      if (url.includes("/api/courses/")) {
        return Promise.resolve(mockCourseResponse(courseProgressFixture));
      }
      return Promise.resolve({ ok: false });
    });
  });

  it("renders module titles from the fixture", async () => {
    render(<CourseOverview courseId="default" />);

    // Wait for the component to load and render
    const firstModule = courseProgressFixture.units[0]?.modules[0];
    expect(firstModule).toBeDefined();

    await waitFor(() => {
      // Use getAllByText since title appears in sidebar and main panel
      const elements = screen.getAllByText(firstModule.title);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it("renders the course title from the fixture", async () => {
    render(<CourseOverview courseId="default" />);

    await waitFor(() => {
      // Course title appears multiple times - use getAllByText
      const elements = screen.getAllByText(courseProgressFixture.course.title);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it("renders multiple modules when fixture has multiple", async () => {
    render(<CourseOverview courseId="default" />);

    // Collect all unique module titles from the fixture
    const allModuleTitles = courseProgressFixture.units.flatMap((unit) =>
      unit.modules.map((m) => m.title),
    );
    const uniqueTitles = [...new Set(allModuleTitles)];

    await waitFor(() => {
      // At least some module titles should be rendered
      // Use queryAllByText to handle multiple matches
      const foundTitles = uniqueTitles.filter(
        (title) => screen.queryAllByText(title).length > 0,
      );
      expect(foundTitles.length).toBeGreaterThan(0);
    });
  });

  it("shows module stages when a module is selected", async () => {
    render(<CourseOverview courseId="default" />);

    const firstModule = courseProgressFixture.units[0]?.modules[0];
    const firstStage = firstModule?.stages[0];

    if (firstStage) {
      await waitFor(() => {
        // Stage title should be visible (component auto-selects first module)
        const elements = screen.getAllByText(firstStage.title);
        expect(elements.length).toBeGreaterThan(0);
      });
    }
  });

  it("handles empty units gracefully", async () => {
    // Override mock for this test
    const emptyFixture = {
      course: { slug: "test", title: "Empty Test Course" },
      units: [],
    };

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/users/me")) {
        return Promise.resolve(mockAuthResponse);
      }
      if (url.includes("/api/courses/")) {
        return Promise.resolve(mockCourseResponse(emptyFixture));
      }
      return Promise.resolve({ ok: false });
    });

    // Should render without crashing
    render(<CourseOverview courseId="default" />);

    await waitFor(() => {
      // Course title should appear (use unique title to avoid conflicts)
      const elements = screen.getAllByText("Empty Test Course");
      expect(elements.length).toBeGreaterThan(0);
    });
  });
});
