import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  sendHeartbeatPing: vi.fn(),
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

const mockModuleWithOptionalChat = {
  slug: "test-module",
  title: "Test Module",
  content_id: "uuid-1",
  sections: [
    {
      type: "lens",
      contentId: "optional-lens-1",
      learningOutcomeId: null,
      learningOutcomeName: null,
      meta: { title: "Optional Lens With Chat" },
      segments: [
        { type: "text", content: "x".repeat(2000) },
        { type: "chat", instructions: "Discuss this." },
      ],
      optional: true,
    },
  ],
};

const mockProgressNotStarted = {
  module: { id: "uuid-1", slug: "test-module", title: "Test Module" },
  status: "not_started" as const,
  progress: { completed: 0, total: 1 },
  lenses: [
    {
      id: "optional-lens-1",
      title: "Optional Lens With Chat",
      type: "lens",
      optional: true,
      completed: false,
      completedAt: null,
      timeSpentS: 0,
    },
  ],
  chatSession: { sessionId: 1, hasMessages: false },
};

describe("Module chat gate for optional lenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isInSignupsTable: false,
      isInActiveGroup: false,
      login: vi.fn(),
    });
    (getModule as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockModuleWithOptionalChat,
    );
    (getModuleProgress as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockProgressNotStarted,
    );
    (getCourseProgress as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (getChatHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessionId: 1,
      messages: [],
    });
  });

  it("enables Mark Complete button on optional lens even without chat interaction", async () => {
    render(<Module courseId="test-course" moduleId="test-module" />);

    await waitFor(() => {
      expect(getModule).toHaveBeenCalled();
    });

    const button = await screen.findByRole("button", {
      name: /mark section complete/i,
    });
    expect(button).not.toHaveAttribute("disabled");
    expect(button.className).not.toContain("opacity-50");
  });
});
