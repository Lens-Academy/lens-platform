import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LensCard from "./LensCard";

describe("LensCard", () => {
  it("renders title and tldr", () => {
    render(
      <LensCard
        title="Why write this book?"
        tldr="The authors argue the situation is serious"
        targetType="lens"
      />,
    );
    expect(screen.getByText("Why write this book?")).toBeDefined();
    expect(screen.getByText(/The authors argue/)).toBeDefined();
  });

  it("shows completion checkmark when completed", () => {
    const { container } = render(
      <LensCard
        title="Test Lens"
        targetType="lens"
        isCompleted={true}
      />,
    );
    expect(container.querySelector("[data-completed]")).not.toBeNull();
  });

  it("shows empty circle when not completed", () => {
    const { container } = render(
      <LensCard
        title="Test Lens"
        targetType="lens"
        isCompleted={false}
      />,
    );
    expect(container.querySelector("[data-completed]")).toBeNull();
    expect(container.querySelector("[data-incomplete]")).not.toBeNull();
  });

  it("renders module variant with book icon", () => {
    render(
      <LensCard
        title="Module 2"
        targetType="module"
        slug="module-2"
      />,
    );
    expect(screen.getByText("Module 2")).toBeDefined();
  });
});
