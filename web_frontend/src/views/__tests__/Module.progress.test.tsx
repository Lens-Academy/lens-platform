import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Module from "../Module";

// Mock the API modules
vi.mock("@/api/modules", () => ({
  getModule: vi.fn(),
  getModuleProgress: vi.fn(),
  getCourseProgress: vi.fn(),
  getChatHistory: vi.fn(),
  getNextModule: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("@/api/progress", () => ({
  markComplete: vi.fn(),
  updateTimeSpent: vi.fn(),
}));

// useAuth mock - we'll configure the return value in tests
const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/hooks/useActivityTracker", () => ({
  useActivityTracker: () => ({ triggerActivity: vi.fn() }),
}));

vi.mock("@/analytics", () => ({
  trackModuleStarted: vi.fn(),
  trackModuleCompleted: vi.fn(),
  trackChatMessageSent: vi.fn(),
}));

import {
  getModule,
  getModuleProgress,
  getCourseProgress,
  getChatHistory,
} from "@/api/modules";
import { markComplete } from "@/api/progress";

const mockModule = {
  slug: "test-module",
  title: "Test Module",
  content_id: "uuid-1",
  sections: [
    {
      type: "lens-article",
      contentId: "lens-1",
      meta: { title: "Section 1" },
      segments: [],
    },
    {
      type: "lens-video",
      contentId: "lens-2",
      videoId: "abc123",
      meta: { title: "Section 2", channel: "Test Channel" },
      segments: [],
    },
  ],
};

const mockProgress = {
  module: { id: "uuid-1", slug: "test-module", title: "Test Module" },
  status: "in_progress" as const,
  progress: { completed: 1, total: 2 },
  lenses: [
    {
      id: "lens-1",
      title: "Section 1",
      type: "lens-article",
      optional: false,
      completed: true,
      completedAt: "2026-01-29T12:00:00Z",
      timeSpentS: 300,
    },
    {
      id: "lens-2",
      title: "Section 2",
      type: "lens-video",
      optional: false,
      completed: false,
      completedAt: null,
      timeSpentS: 0,
    },
  ],
  chatSession: { sessionId: 1, hasMessages: false },
};

describe("Module progress loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default auth mock: authenticated user
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    });
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(mockModule);
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("fetches progress from API on mount", async () => {
    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockProgress,
    );

    render(<Module courseId="test-course" moduleId="test-module" />);

    // The test expects getModuleProgress to be called on mount
    // Currently Module.tsx does NOT call getModuleProgress, so this should FAIL
    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalledWith("test-module");
    });
  });

  it("displays progress from API response, not localStorage", async () => {
    // Set localStorage with NO completed sections
    localStorage.setItem("module-completed-test-module", JSON.stringify([]));

    // API says section 0 (Section 1) is completed
    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockProgress,
    );

    render(<Module courseId="test-course" moduleId="test-module" />);

    // Wait for component to load and call getModuleProgress
    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalled();
    });

    // Should show "Section completed" because API says section 0 is complete
    // (even though localStorage says nothing is complete)
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });
  });

  it("does not use localStorage for initial progress state", async () => {
    // Set localStorage with section 1 complete (different from API which has section 0 complete)
    localStorage.setItem("module-completed-test-module", JSON.stringify([1]));

    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockProgress,
    );

    render(<Module courseId="test-course" moduleId="test-module" />);

    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalled();
    });

    // The API says section 0 is completed, not section 1
    // If Module.tsx correctly ignores localStorage and uses API,
    // section 0 should show as completed
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });
  });
});

describe("Module progress updates from completion response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default auth mock: authenticated user
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    });
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(mockModule);
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("updates completedSections from markComplete response lenses array", async () => {
    // Initial: no sections completed
    const initialProgress = {
      ...mockProgress,
      status: "not_started" as const,
      progress: { completed: 0, total: 2 },
      lenses: [
        { ...mockProgress.lenses[0], completed: false, completedAt: null },
        { ...mockProgress.lenses[1] },
      ],
    };

    // After completion: section 0 is completed
    const completionResponse = {
      completed_at: "2026-01-29T13:00:00Z",
      module_status: "in_progress",
      module_progress: { completed: 1, total: 2 },
      lenses: [
        {
          id: "lens-1",
          title: "Section 1",
          type: "lens-article",
          optional: false,
          completed: true,
          completedAt: "2026-01-29T13:00:00Z",
          timeSpentS: 0,
        },
        {
          id: "lens-2",
          title: "Section 2",
          type: "lens-video",
          optional: false,
          completed: false,
          completedAt: null,
          timeSpentS: 0,
        },
      ],
    };

    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
      initialProgress,
    );
    (markComplete as ReturnType<typeof vi.fn>).mockResolvedValue(
      completionResponse,
    );

    render(<Module courseId="test-course" moduleId="test-module" />);

    // Wait for initial load - should show "Mark section complete" button
    await waitFor(() => {
      expect(screen.getByText("Mark section complete")).toBeInTheDocument();
    });

    // Click mark complete
    const completeButton = screen.getByText("Mark section complete");
    await userEvent.click(completeButton);

    // markComplete should be called with module_slug
    await waitFor(() => {
      expect(markComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          module_slug: "test-module",
        }),
        expect.any(Boolean),
      );
    });

    // After completing section 0, we navigate to section 1 (paginated mode)
    // Navigate back to section 0 by clicking the previous button
    const prevButton = screen.getAllByRole("button").find((btn) => {
      const svg = btn.querySelector('path[d="M15 19l-7-7 7-7"]');
      return svg !== null;
    });
    expect(prevButton).toBeDefined();
    await userEvent.click(prevButton!);

    // Now we're back on section 0 - should show "Section completed"
    await waitFor(() => {
      expect(screen.getByText("Section completed")).toBeInTheDocument();
    });

    // Should NOT re-fetch progress (response already has full state)
    expect(getModuleProgress).toHaveBeenCalledTimes(1); // Only initial load
  });
});

describe("Module progress on login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(mockModule);
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("re-fetches progress when user logs in (claiming happens server-side during OAuth)", async () => {
    // Start anonymous
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    });

    const anonymousProgress = {
      ...mockProgress,
      progress: { completed: 1, total: 2 },
      lenses: [
        { ...mockProgress.lenses[0], completed: true },
        { ...mockProgress.lenses[1], completed: false },
      ],
    };

    const authenticatedProgress = {
      ...mockProgress,
      progress: { completed: 2, total: 2 },
      status: "completed" as const,
      lenses: [
        { ...mockProgress.lenses[0], completed: true },
        { ...mockProgress.lenses[1], completed: true },
      ],
    };

    (getModuleProgress as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(anonymousProgress)
      .mockResolvedValueOnce(authenticatedProgress);

    const { rerender } = render(
      <Module courseId="test-course" moduleId="test-module" />,
    );

    // Wait for initial load
    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalledTimes(1);
    });

    // Simulate login - change auth state and rerender
    // Note: In real flow, claiming happens server-side during OAuth callback
    // before the redirect back to the frontend
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    });
    rerender(<Module courseId="test-course" moduleId="test-module" />);

    // Should re-fetch progress (now includes claimed records from server)
    await waitFor(() => {
      expect(getModuleProgress).toHaveBeenCalledTimes(2);
    });
  });
});
