import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("Block note directive (container)", () => {
  it("always shows note content for :::note", () => {
    const article = makeArticle(
      "Visible.\n\n:::note\nThis is a note.\n:::\n\nAfter.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByText("This is a note.")).toBeInTheDocument();
  });

  it("does not render a toggle button", () => {
    const article = makeArticle(
      "Visible.\n\n:::note\nThis is a note.\n:::\n\nAfter.",
    );
    render(<ArticleEmbed article={article} />);

    expect(
      screen.queryByRole("button", { name: /course note/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Block note directive (leaf)", () => {
  it("renders ::note[text] as always-visible block note", () => {
    const article = makeArticle(
      "Before.\n\n::note[This is a leaf note.]\n\nAfter.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByText("This is a leaf note.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /course note/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Inline note directive", () => {
  it("always shows :note[text] inline", () => {
    const article = makeArticle(
      "The concept of :note[this is key] power-seeking is important.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByText(/this is key/)).toBeInTheDocument();
  });

  it("does not render a toggle button", () => {
    const article = makeArticle(
      "The concept of :note[this is key] power-seeking is important.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Block note with {open} attribute (ignored)", () => {
  it("still renders content (open has no effect)", () => {
    const article = makeArticle(
      "Visible.\n\n::note[Read carefully.]{open}\n\nAfter.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByText("Read carefully.")).toBeInTheDocument();
  });
});

describe("Regression: articles without note directives", () => {
  it("renders plain markdown with no note UI", () => {
    const article = makeArticle(
      "# Heading\n\nNormal paragraph.\n\n**Bold text**.",
    );
    render(<ArticleEmbed article={article} />);

    expect(
      screen.queryByRole("button", { name: /course note/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Normal paragraph.")).toBeInTheDocument();
  });
});

describe("Note inside collapse", () => {
  it("renders note within collapsed section", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const article = makeArticle(
      ":::collapse\nSome collapsed content.\n\n::note[We collapsed this because it's off-topic.]\n:::",
    );
    render(<ArticleEmbed article={article} />);

    await user.click(screen.getByRole("button", { name: /\[\.{3}\]/ }));

    expect(
      screen.getByText("We collapsed this because it's off-topic."),
    ).toBeInTheDocument();
  });
});
