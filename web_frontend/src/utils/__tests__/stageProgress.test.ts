// web_frontend/src/utils/__tests__/stageProgress.test.ts
import { describe, it, expect } from "vitest";
import { getCircleFillClasses, getRingClasses } from "../stageProgress";

describe("getCircleFillClasses", () => {
  it("completed, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: true, isViewing: false, isOptional: false }),
    ).toBe("bg-blue-500 text-white");
  });

  it("completed, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: true, isViewing: false, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-blue-500 text-white hover:bg-blue-600");
  });

  it("completed takes priority over viewing, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: true, isViewing: true, isOptional: false }),
    ).toBe("bg-blue-500 text-white");
  });

  it("completed takes priority over viewing, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: true, isViewing: true, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-blue-500 text-white hover:bg-blue-600");
  });

  it("viewing, not completed, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: true, isOptional: false }),
    ).toBe("bg-gray-500 text-white");
  });

  it("viewing, not completed, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: true, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-gray-500 text-white hover:bg-gray-600");
  });

  it("default state, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: false, isOptional: false }),
    ).toBe("bg-gray-200 text-gray-400");
  });

  it("default state, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: false, isOptional: false },
        { includeHover: true },
      ),
    ).toBe("bg-gray-200 text-gray-400 hover:bg-gray-300");
  });

  it("optional completed, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: true, isViewing: false, isOptional: true }),
    ).toBe("bg-white text-blue-500 border-2 border-dashed border-blue-400");
  });

  it("optional completed, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: true, isViewing: false, isOptional: true },
        { includeHover: true },
      ),
    ).toBe("bg-white text-blue-500 border-2 border-dashed border-blue-400 hover:border-blue-500");
  });

  it("optional viewing, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: true, isOptional: true }),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-400");
  });

  it("optional viewing, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: true, isOptional: true },
        { includeHover: true },
      ),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-400 hover:border-gray-500");
  });

  it("optional default, no hover", () => {
    expect(
      getCircleFillClasses({ isCompleted: false, isViewing: false, isOptional: true }),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-300");
  });

  it("optional default, with hover", () => {
    expect(
      getCircleFillClasses(
        { isCompleted: false, isViewing: false, isOptional: true },
        { includeHover: true },
      ),
    ).toBe("bg-white text-gray-400 border-2 border-dashed border-gray-300 hover:border-gray-400");
  });
});

describe("getRingClasses", () => {
  it("returns empty string when not viewing", () => {
    expect(getRingClasses(false, false)).toBe("");
    expect(getRingClasses(false, true)).toBe("");
  });

  it("returns blue ring when viewing and completed", () => {
    expect(getRingClasses(true, true)).toBe("ring-2 ring-offset-2 ring-blue-500");
  });

  it("returns gray ring when viewing and not completed", () => {
    expect(getRingClasses(true, false)).toBe("ring-2 ring-offset-2 ring-gray-500");
  });
});
