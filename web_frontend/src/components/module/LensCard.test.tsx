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

  it("uses lens-gold dot when completed", () => {
    const { container } = render(
      <LensCard title="Test Lens" targetType="lens" isCompleted={true} />,
    );
    // The dot should have the lens-gold fill class
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-lens-gold-400");
    expect(dot!.className).toContain("text-white");
  });

  it("uses gray dot when not completed", () => {
    const { container } = render(
      <LensCard title="Test Lens" targetType="lens" isCompleted={false} />,
    );
    const dot = container.querySelector(".rounded-full");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-gray-200");
    expect(dot!.className).toContain("text-gray-400");
  });

  it("renders module variant", () => {
    render(
      <LensCard title="Module 2" targetType="module" slug="module-2" />,
    );
    expect(screen.getByText("Module 2")).toBeDefined();
  });

  it("renders as link when href provided", () => {
    render(
      <LensCard title="Linked" targetType="lens" href="#test" />,
    );
    const link = screen.getByText("Linked").closest("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("#test");
  });
});
