import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthoredText from "./AuthoredText";

describe("AuthoredText lens links", () => {
  it("renders lens: scheme as a same-module hash link", () => {
    render(
      <AuthoredText
        content="See [My Lens](lens:aaaa-bbbb)"
        courseId="my-course"
        moduleSlug="my-module"
        moduleSections={[
          { contentId: "aaaa-bbbb", meta: { title: "My Lens" } },
        ]}
      />,
    );
    const link = screen.getByText("My Lens");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toMatch(/#/);
  });

  it("renders module: scheme as a course module link", () => {
    render(
      <AuthoredText
        content="See [Module 2](module:my-module-2)"
        courseId="my-course"
      />,
    );
    const link = screen.getByText("Module 2");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      "/course/my-course/module/my-module-2",
    );
  });

  it("renders regular links unchanged", () => {
    render(<AuthoredText content="Visit [example](https://example.com)" />);
    const link = screen.getByText("example");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});

describe("AuthoredText card links", () => {
  it("renders data-lens-card div as a LensCard component", () => {
    const cardData = JSON.stringify({
      contentId: "aaaa-bbbb",
      targetType: "lens",
      title: "My Card Title",
      tldr: "A summary",
    });
    render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        moduleSlug="my-module"
      />,
    );
    expect(screen.getByText("My Card Title")).toBeDefined();
    expect(screen.getByText("A summary")).toBeDefined();
  });

  it("shows completion state on card when contentId is in completedContentIds", () => {
    const cardData = JSON.stringify({
      contentId: "aaaa-bbbb",
      targetType: "lens",
      title: "Completed Lens",
    });
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        completedContentIds={new Set(["aaaa-bbbb"])}
      />,
    );
    // Completed card has lens-gold dot
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-lens-orange-400");
  });
});

describe("cross-module lens links", () => {
  it("renders lens:contentId@moduleSlug as a cross-module link", () => {
    render(
      <AuthoredText
        content="See [Other Lens](lens:aaaa-bbbb@other-module)"
        courseId="my-course"
        moduleSlug="current-module"
        moduleSections={[]}
      />,
    );
    const link = screen.getByText("Other Lens");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(
      "/course/my-course/module/other-module#other-lens",
    );
  });

  it("renders lens:contentId (no moduleSlug, not in current module) as standalone lens link", () => {
    render(
      <AuthoredText
        content="See [Standalone](lens:aaaa-bbbb)"
        courseId="my-course"
        moduleSlug="current-module"
        moduleSections={[]}
      />,
    );
    const link = screen.getByText("Standalone");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/lens/aaaa-bbbb");
  });
});

describe("cross-module card completion", () => {
  it("shows completion for cross-module card when contentId is in allCompletedContentIds", () => {
    const cardData = JSON.stringify({
      contentId: "cross-mod-id",
      targetType: "lens",
      title: "Cross-Module Lens",
      moduleSlug: "other-module",
    });
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        allCompletedContentIds={new Set(["cross-mod-id"])}
      />,
    );
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-lens-orange-400");
  });

  it("does not show completion when cross-module card contentId is not completed", () => {
    const cardData = JSON.stringify({
      contentId: "not-done-id",
      targetType: "lens",
      title: "Not Done Lens",
      moduleSlug: "other-module",
    });
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        allCompletedContentIds={new Set()}
      />,
    );
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-gray-200");
  });
});

describe("module card with progress", () => {
  it("renders module card with progress circle", () => {
    const cardData = JSON.stringify({
      targetType: "module",
      title: "Module 3",
      slug: "mod-3",
    });
    const moduleProgressMap = new Map([
      [
        "mod-3",
        { status: "in_progress" as const, completedLenses: 2, totalLenses: 5 },
      ],
    ]);
    const { container } = render(
      <AuthoredText
        content={`<div data-lens-card='${cardData}'></div>`}
        courseId="my-course"
        moduleProgressMap={moduleProgressMap}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});
