// web_frontend/src/__tests__/anonymous-session-flow.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// Mock the API and auth
vi.mock("../api/lessons", () => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
  claimSession: vi.fn(),
  advanceStage: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

import UnifiedLesson from "../pages/UnifiedLesson";
import * as lessonsApi from "../api/lessons";
import { useAuth } from "../hooks/useAuth";

// Helper to wrap UnifiedLesson with proper routing
function renderWithRouter(lessonId: string) {
  return render(
    <MemoryRouter initialEntries={[`/lesson/${lessonId}`]}>
      <Routes>
        <Route path="/lesson/:lessonId" element={<UnifiedLesson />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Anonymous Session Flow", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("creates anonymous session and stores in localStorage", async () => {
    // Setup: not authenticated
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
    });

    (lessonsApi.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      123
    );
    (lessonsApi.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: 123,
      user_id: null,
      lesson_slug: "test",
      lesson_title: "Test Lesson",
      current_stage_index: 0,
      total_stages: 1,
      messages: [],
      stages: [
        {
          type: "chat",
          instructions: "",
          showUserPreviousContent: false,
          showTutorPreviousContent: false,
        },
      ],
      current_stage: {
        type: "chat",
        instructions: "",
        showUserPreviousContent: false,
        showTutorPreviousContent: false,
      },
      completed: false,
      article: null,
      previous_article: null,
      previous_stage: null,
      show_user_previous_content: false,
    });

    // Mock sendMessage as an async generator for auto-initiation
    (lessonsApi.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async function* () {
        yield { type: "text", content: "Hello! How can I help you?" };
      }
    );

    renderWithRouter("test");

    await waitFor(() => {
      expect(lessonsApi.createSession).toHaveBeenCalledWith("test");
    });

    // Session ID should be stored
    expect(localStorage.getItem("lesson_session_test")).toBe("123");
  });

  it("claims session after authentication", async () => {
    // Setup: localStorage has session, user now authenticated
    localStorage.setItem("lesson_session_test", "123");

    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
    });

    (lessonsApi.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: 123,
      user_id: null, // Still unclaimed
      lesson_slug: "test",
      lesson_title: "Test Lesson",
      current_stage_index: 0,
      total_stages: 1,
      messages: [{ role: "user", content: "hello" }],
      stages: [
        {
          type: "chat",
          instructions: "",
          showUserPreviousContent: false,
          showTutorPreviousContent: false,
        },
      ],
      current_stage: {
        type: "chat",
        instructions: "",
        showUserPreviousContent: false,
        showTutorPreviousContent: false,
      },
      completed: false,
      article: null,
      previous_article: null,
      previous_stage: null,
      show_user_previous_content: false,
    });

    (lessonsApi.claimSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      claimed: true,
    });

    // Mock sendMessage as an async generator for auto-initiation
    (lessonsApi.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      async function* () {
        yield { type: "text", content: "Welcome back!" };
      }
    );

    renderWithRouter("test");

    await waitFor(() => {
      expect(lessonsApi.claimSession).toHaveBeenCalledWith(123);
    });
  });

  it("shows auth prompt when anonymous user advances past first content stage", async () => {
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
    });

    (lessonsApi.createSession as ReturnType<typeof vi.fn>).mockResolvedValue(
      123
    );
    (lessonsApi.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      session_id: 123,
      user_id: null,
      lesson_slug: "test",
      lesson_title: "Test Lesson",
      current_stage_index: 1, // On article stage
      total_stages: 2,
      messages: [],
      stages: [
        {
          type: "chat",
          instructions: "",
          showUserPreviousContent: false,
          showTutorPreviousContent: false,
        },
        { type: "article", source: "test-source", from: null, to: null },
      ],
      current_stage: {
        type: "article",
        source: "test-source",
        from: null,
        to: null,
      },
      completed: false,
      article: { content: "Test article content", title: "Test Article" },
      previous_article: null,
      previous_stage: null,
      show_user_previous_content: false,
    });

    renderWithRouter("test");

    // Wait for the component to load - look for the "Done reading" button which shows on article stage
    await waitFor(() => {
      expect(screen.getByTestId("done-reading-button")).toBeInTheDocument();
    });

    // Find and click the skip/done button (there are two - mobile and desktop)
    const skipButtons = screen.getAllByText(/skip section/i);
    fireEvent.click(skipButtons[0]);

    // Auth prompt should appear (check for the heading specifically)
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /save your progress/i })
      ).toBeInTheDocument();
    });
  });
});
