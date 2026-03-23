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
