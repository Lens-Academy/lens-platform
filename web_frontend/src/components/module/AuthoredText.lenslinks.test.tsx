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
    expect(link.getAttribute("href")).toBe("/course/my-course/module/my-module-2");
  });

  it("renders regular links unchanged", () => {
    render(
      <AuthoredText
        content="Visit [example](https://example.com)"
      />,
    );
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
    expect(dot!.className).toContain("bg-lens-gold-400");
  });
});
