import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Stage } from "@/types/module";
import type { StageInfo } from "@/types/course";

// Mock Tooltip as passthrough (avoids floating-ui portal issues in tests)
vi.mock("@/components/Tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactElement }) => children,
}));

// Mock haptics
vi.mock("@/utils/haptics", () => ({
  triggerHaptic: vi.fn(),
}));

import StageProgressBar from "../StageProgressBar";
import ModuleOverview from "../../course/ModuleOverview";

// --- Test data ---

const mockStages: Stage[] = [
  { type: "article", source: "", from: null, to: null, title: "Lesson 1" },
  { type: "article", source: "", from: null, to: null, title: "Lesson 2" },
  // Use type assertion for test stage (same pattern as Module.tsx)
  {
    type: "test",
    source: "",
    from: null,
    to: null,
    title: "Test",
  } as unknown as Stage,
];

const mockStageInfos: StageInfo[] = [
  { title: "Lesson 1", type: "article", duration: null, optional: false },
  { title: "Lesson 2", type: "article", duration: null, optional: false },
  { title: "Test", type: "test", duration: null, optional: false },
];

// --- StageProgressBar content hiding ---

describe("StageProgressBar content hiding", () => {
  const defaultProps = {
    stages: mockStages,
    completedStages: new Set<number>(),
    currentSectionIndex: 2, // viewing the test section
    onStageClick: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    canGoPrevious: true,
    canGoNext: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dims non-test dots when testModeActive is true", () => {
    render(<StageProgressBar {...defaultProps} testModeActive={true} />);

    // Find all dot buttons (excluding prev/next nav buttons)
    const allButtons = screen.getAllByRole("button");
    // Dot buttons are the ones that are NOT the prev/next arrows
    // The StageProgressBar renders: prev button, dots..., next button
    // We identify dot buttons by checking they are not the first or last
    const dotButtons = allButtons.filter(
      (btn) => !btn.querySelector("svg path[d*='M15 19']") && !btn.querySelector("svg path[d*='M9 5']"),
    );

    // First two dots (Lesson 1 & 2) should be dimmed
    expect(dotButtons[0].className).toContain("opacity-30");
    expect(dotButtons[1].className).toContain("opacity-30");

    // Test dot should NOT be dimmed
    expect(dotButtons[2].className).not.toContain("opacity-30");
  });

  it("does not dim dots when testModeActive is false", () => {
    render(<StageProgressBar {...defaultProps} testModeActive={false} />);

    const allButtons = screen.getAllByRole("button");
    const dotButtons = allButtons.filter(
      (btn) => !btn.querySelector("svg path[d*='M15 19']") && !btn.querySelector("svg path[d*='M9 5']"),
    );

    // No dots should have opacity-30 dimming
    dotButtons.forEach((btn) => {
      expect(btn.className).not.toContain("opacity-30");
    });
  });

  it("blocks click on non-test dots during test mode", async () => {
    const user = userEvent.setup();
    const onStageClick = vi.fn();

    render(
      <StageProgressBar
        {...defaultProps}
        onStageClick={onStageClick}
        testModeActive={true}
      />,
    );

    const allButtons = screen.getAllByRole("button");
    const dotButtons = allButtons.filter(
      (btn) => !btn.querySelector("svg path[d*='M15 19']") && !btn.querySelector("svg path[d*='M9 5']"),
    );

    // Click a lesson dot -- should NOT call onStageClick
    await user.click(dotButtons[0]);
    expect(onStageClick).not.toHaveBeenCalled();

    // Click the test dot -- should still work
    await user.click(dotButtons[2]);
    expect(onStageClick).toHaveBeenCalledWith(2);
  });
});

// --- ModuleOverview content hiding ---

describe("ModuleOverview content hiding", () => {
  const defaultProps = {
    moduleTitle: "Test Module",
    stages: mockStageInfos,
    status: "in_progress" as const,
    completedStages: new Set<number>(),
    currentSectionIndex: 2, // viewing the test section
    onStageClick: vi.fn(),
    showActions: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dims lesson items when testModeActive is true", () => {
    render(
      <ModuleOverview {...defaultProps} testModeActive={true} />,
    );

    // Find the stage row containers (the group divs that contain stage info)
    // Each stage row has a text title inside it
    const lesson1Row = screen.getByText("Lesson 1").closest('[class*="group"]');
    const lesson2Row = screen.getByText("Lesson 2").closest('[class*="group"]');
    const testRow = screen.getByText("Test").closest('[class*="group"]');

    // Lesson rows should be dimmed
    expect(lesson1Row?.className).toContain("opacity-30");
    expect(lesson2Row?.className).toContain("opacity-30");

    // Test row should NOT be dimmed
    expect(testRow?.className).not.toContain("opacity-30");
  });

  it("does not dim items when testModeActive is false", () => {
    render(<ModuleOverview {...defaultProps} testModeActive={false} />);

    const lesson1Row = screen.getByText("Lesson 1").closest('[class*="group"]');
    const lesson2Row = screen.getByText("Lesson 2").closest('[class*="group"]');
    const testRow = screen.getByText("Test").closest('[class*="group"]');

    // No rows should be dimmed
    expect(lesson1Row?.className).not.toContain("opacity-30");
    expect(lesson2Row?.className).not.toContain("opacity-30");
    expect(testRow?.className).not.toContain("opacity-30");
  });
});
