import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TestSection from "../TestSection";
import type { TestSection as TestSectionType } from "@/types/module";

// Mock dependencies
vi.mock("@/api/questions", () => ({
  getResponses: vi.fn(),
}));

vi.mock("@/api/progress", () => ({
  markComplete: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

// Mock AnswerBox as a simple div with a Complete button
vi.mock("@/components/module/AnswerBox", () => ({
  default: (props: {
    segment: { userInstruction: string };
    onComplete?: () => void;
    moduleSlug: string;
    sectionIndex: number;
    segmentIndex: number;
  }) => {
    const questionId = `${props.moduleSlug}:${props.sectionIndex}:${props.segmentIndex}`;
    return (
      <div data-testid={`answer-box-${questionId}`}>
        <span>{props.segment.userInstruction}</span>
        <button onClick={() => props.onComplete?.()}>Complete</button>
      </div>
    );
  },
}));

import { getResponses } from "@/api/questions";
import { markComplete } from "@/api/progress";

function makeTestSection(questionCount: number): TestSectionType {
  return {
    type: "test" as const,
    contentId: null,
    learningOutcomeId: null,
    learningOutcomeName: null,
    meta: { title: "Unit Test" },
    segments: Array.from({ length: questionCount }, (_, i) => ({
      type: "question" as const,
      userInstruction: `Question ${i + 1} prompt`,
    })),
    optional: false,
  };
}

const defaultProps = {
  moduleSlug: "test-module",
  sectionIndex: 2,
  isAuthenticated: true,
  onTestStart: vi.fn(),
  onTestTakingComplete: vi.fn(),
  onMarkComplete: vi.fn(),
};

describe("TestSection Begin screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getResponses as ReturnType<typeof vi.fn>).mockResolvedValue({
      responses: [],
    });
  });

  it("shows question count on Begin screen", async () => {
    render(<TestSection section={makeTestSection(3)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/3 questions/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Begin")).toBeInTheDocument();
  });

  it("does not show any question content before Begin is clicked", async () => {
    render(<TestSection section={makeTestSection(3)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    expect(screen.queryByText("Question 1 prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Question 2 prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Question 3 prompt")).not.toBeInTheDocument();
  });
});

describe("TestSection sequential question reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getResponses as ReturnType<typeof vi.fn>).mockResolvedValue({
      responses: [],
    });
  });

  it("shows first question after clicking Begin", async () => {
    const user = userEvent.setup();

    render(<TestSection section={makeTestSection(3)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });
  });

  it("shows only the first question initially, not subsequent ones", async () => {
    const user = userEvent.setup();

    render(<TestSection section={makeTestSection(3)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("answer-box-test-module:2:1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("answer-box-test-module:2:2"),
    ).not.toBeInTheDocument();
  });

  it("reveals next question after completing current one", async () => {
    const user = userEvent.setup();

    render(<TestSection section={makeTestSection(3)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });

    // Complete Q1
    const completeButtons = screen.getAllByText("Complete");
    await user.click(completeButtons[0]);

    // Q2 should now appear
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:1"),
      ).toBeInTheDocument();
    });
  });

  it("collapses completed question", async () => {
    const user = userEvent.setup();

    render(<TestSection section={makeTestSection(3)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });

    // Complete Q1
    const completeButtons = screen.getAllByText("Complete");
    await user.click(completeButtons[0]);

    // Q1 should be collapsed -- answer-box gone, "Answered" text visible
    await waitFor(() => {
      expect(
        screen.queryByTestId("answer-box-test-module:2:0"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Answered")).toBeInTheDocument();
  });
});

describe("TestSection completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getResponses as ReturnType<typeof vi.fn>).mockResolvedValue({
      responses: [],
    });
    (markComplete as ReturnType<typeof vi.fn>).mockResolvedValue({
      completed_at: "2026-02-16T12:00:00Z",
    });
  });

  it("calls onTestTakingComplete when all questions are answered", async () => {
    const user = userEvent.setup();
    const onTestTakingComplete = vi.fn();

    render(
      <TestSection
        section={makeTestSection(2)}
        {...defaultProps}
        onTestTakingComplete={onTestTakingComplete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    // Complete Q1
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });
    const completeQ1 = screen.getAllByText("Complete");
    await user.click(completeQ1[0]);

    // Complete Q2
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:1"),
      ).toBeInTheDocument();
    });
    const completeQ2 = screen.getAllByText("Complete");
    await user.click(completeQ2[0]);

    await waitFor(() => {
      expect(onTestTakingComplete).toHaveBeenCalled();
    });
  });

  it("calls onMarkComplete with progress API when all questions done", async () => {
    const user = userEvent.setup();
    const onMarkComplete = vi.fn();

    render(
      <TestSection
        section={makeTestSection(2)}
        {...defaultProps}
        onMarkComplete={onMarkComplete}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    // Complete Q1
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getAllByText("Complete")[0]);

    // Complete Q2
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:1"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getAllByText("Complete")[0]);

    await waitFor(() => {
      expect(onMarkComplete).toHaveBeenCalled();
    });
  });

  it("shows all questions as collapsed/completed after finishing", async () => {
    const user = userEvent.setup();

    render(<TestSection section={makeTestSection(2)} {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    // Complete Q1
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:0"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getAllByText("Complete")[0]);

    // Complete Q2
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:1"),
      ).toBeInTheDocument();
    });
    await user.click(screen.getAllByText("Complete")[0]);

    // Both questions should show "Answered"
    await waitFor(() => {
      const answeredElements = screen.getAllByText("Answered");
      expect(answeredElements).toHaveLength(2);
    });
  });
});

describe("TestSection resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips Begin screen when responses already exist", async () => {
    // Q1 has a completed response, Q2 has no response
    (getResponses as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ questionId }: { questionId: string }) => {
        if (questionId === "test-module:2:0") {
          return {
            responses: [
              {
                response_id: 1,
                question_id: "test-module:2:0",
                module_slug: "test-module",
                question_text: "What is AI safety?",
                question_hash: "abc123",
                answer_text: "My answer to Q1",
                answer_metadata: {},
                created_at: "2026-02-16T11:00:00Z",
                completed_at: "2026-02-16T11:01:00Z",
              },
            ],
          };
        }
        return { responses: [] };
      },
    );

    render(<TestSection section={makeTestSection(2)} {...defaultProps} />);

    // Should NOT show Begin button (we have existing responses)
    await waitFor(() => {
      expect(screen.queryByText("Begin")).not.toBeInTheDocument();
    });

    // Q1 should be collapsed with "Answered"
    await waitFor(() => {
      expect(screen.getByText("Answered")).toBeInTheDocument();
    });

    // Q2 should have a reveal mechanism (the answer-box for Q2 should appear
    // or a reveal button should be visible)
    await waitFor(() => {
      expect(
        screen.getByTestId("answer-box-test-module:2:1"),
      ).toBeInTheDocument();
    });
  });

  it("shows completed state when all responses are complete", async () => {
    // Both questions have completed responses
    (getResponses as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ questionId }: { questionId: string }) => {
        if (questionId === "test-module:2:0") {
          return {
            responses: [
              {
                response_id: 1,
                question_id: "test-module:2:0",
                module_slug: "test-module",
                question_text: "What is AI safety?",
                question_hash: "abc123",
                answer_text: "My answer to Q1",
                answer_metadata: {},
                created_at: "2026-02-16T11:00:00Z",
                completed_at: "2026-02-16T11:01:00Z",
              },
            ],
          };
        }
        if (questionId === "test-module:2:1") {
          return {
            responses: [
              {
                response_id: 2,
                question_id: "test-module:2:1",
                module_slug: "test-module",
                question_text: "What is AI safety?",
                question_hash: "abc123",
                answer_text: "My answer to Q2",
                answer_metadata: {},
                created_at: "2026-02-16T11:02:00Z",
                completed_at: "2026-02-16T11:03:00Z",
              },
            ],
          };
        }
        return { responses: [] };
      },
    );

    render(<TestSection section={makeTestSection(2)} {...defaultProps} />);

    // Should NOT show Begin button
    await waitFor(() => {
      expect(screen.queryByText("Begin")).not.toBeInTheDocument();
    });

    // Both should show "Answered"
    await waitFor(() => {
      const answeredElements = screen.getAllByText("Answered");
      expect(answeredElements).toHaveLength(2);
    });
  });
});

describe("TestSection onTestStart callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getResponses as ReturnType<typeof vi.fn>).mockResolvedValue({
      responses: [],
    });
  });

  it("calls onTestStart when Begin is clicked", async () => {
    const user = userEvent.setup();
    const onTestStart = vi.fn();

    render(
      <TestSection
        section={makeTestSection(3)}
        {...defaultProps}
        onTestStart={onTestStart}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Begin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Begin"));

    expect(onTestStart).toHaveBeenCalled();
  });
});
