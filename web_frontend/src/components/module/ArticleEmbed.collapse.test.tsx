import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ArticleEmbed from "./ArticleEmbed";
import type { ArticleData } from "@/types/module";

function makeArticle(content: string): ArticleData {
  return {
    content,
    title: "Test Article",
    author: "Test Author",
    sourceUrl: null,
  };
}

const user = userEvent.setup();

describe("Block collapse directive", () => {
  it("renders [...] button when content contains :::collapse", () => {
    const article = makeArticle(
      "Visible paragraph.\n\n:::collapse\nHidden content here.\n:::\n\nAfter collapse.",
    );
    render(<ArticleEmbed article={article} />);

    expect(
      screen.getByRole("button", { name: /\[\.{3}\]/ }),
    ).toBeInTheDocument();
  });

  it("hides collapsed content by default (grid-rows-[0fr])", () => {
    const article = makeArticle(
      "Visible paragraph.\n\n:::collapse\nHidden content here.\n:::\n\nAfter collapse.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByText("Visible paragraph.")).toBeInTheDocument();
    expect(screen.getByText("After collapse.")).toBeInTheDocument();
    // Content exists in DOM but is inside a collapsed grid container
    const hiddenContent = screen.getByText("Hidden content here.");
    expect(hiddenContent).toBeInTheDocument();
    const gridContainer = hiddenContent.closest(".grid");
    expect(gridContainer).toHaveClass("grid-rows-[0fr]");
  });

  it("expands collapsed content on click", async () => {
    const article = makeArticle(
      "Visible paragraph.\n\n:::collapse\nHidden content here.\n:::\n\nAfter collapse.",
    );
    render(<ArticleEmbed article={article} />);

    const button = screen.getByRole("button", { name: /\[\.{3}\]/ });
    await user.click(button);

    const hiddenContent = screen.getByText("Hidden content here.");
    const gridContainer = hiddenContent.closest(".grid");
    expect(gridContainer).toHaveClass("grid-rows-[1fr]");
  });
});

describe("Inline collapse directive", () => {
  it("renders [...] inline when content contains :collapse[text]", () => {
    const article = makeArticle(
      "The concept of :collapse[power-seeking behavior] is important.",
    );
    render(<ArticleEmbed article={article} />);

    // The [...] button should be inline in the paragraph
    const button = screen.getByRole("button", { name: "[...]" });
    expect(button).toBeInTheDocument();
    // The hidden text should NOT be in the DOM when collapsed
    expect(screen.queryByText("power-seeking behavior")).not.toBeInTheDocument();
  });

  it("shows inline text when clicked", async () => {
    const article = makeArticle(
      "The concept of :collapse[power-seeking behavior] is important.",
    );
    render(<ArticleEmbed article={article} />);

    const button = screen.getByRole("button", { name: "[...]" });
    await user.click(button);

    expect(screen.getByText(/power-seeking behavior/)).toBeInTheDocument();
  });
});

describe("Regression: articles without directives", () => {
  it("renders plain markdown normally with no collapse UI", () => {
    const article = makeArticle(
      "# Introduction\n\nThis is a normal paragraph.\n\n**Bold text** and *italic text*.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByText("Introduction")).toBeInTheDocument();
    expect(screen.getByText(/This is a normal paragraph/)).toBeInTheDocument();
    expect(screen.getByText("Bold text")).toBeInTheDocument();
    // No collapse buttons should exist
    expect(screen.queryByRole("button", { name: /\[\.{3}\]/ })).not.toBeInTheDocument();
  });
});
