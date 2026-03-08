import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Inline footnote directive", () => {
  it("renders an icon for :footnote[text], not the text directly", () => {
    const article = makeArticle(
      "The concept of :footnote[extra detail here] power-seeking is important.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByRole("img", { name: /footnote/i })).toBeInTheDocument();
    expect(screen.queryByText("extra detail here")).not.toBeInTheDocument();
  });

  it("shows the popup with text when hovering the icon", async () => {
    const user = userEvent.setup();
    const article = makeArticle(
      "The concept of :footnote[extra detail here] power-seeking is important.",
    );
    render(<ArticleEmbed article={article} />);

    const icon = screen.getByRole("img", { name: /footnote/i });
    await user.hover(icon.parentElement!);

    expect(screen.getByText("extra detail here")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("hides the popup after mouse leaves (with delay)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    const article = makeArticle("Some text :footnote[hover info] more text.");
    render(<ArticleEmbed article={article} />);

    const icon = screen.getByRole("img", { name: /footnote/i });
    await user.hover(icon.parentElement!);
    expect(screen.getByText("hover info")).toBeInTheDocument();

    await user.unhover(icon.parentElement!);

    // Still visible immediately (300ms delay)
    expect(screen.getByText("hover info")).toBeInTheDocument();

    // After 300ms, should be hidden
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByText("hover info")).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it("renders ::footnote[text] (leaf form) the same as text form", () => {
    const article = makeArticle(
      "Before.\n\n::footnote[leaf footnote content]\n\nAfter.",
    );
    render(<ArticleEmbed article={article} />);

    expect(screen.getByRole("img", { name: /footnote/i })).toBeInTheDocument();
    expect(screen.queryByText("leaf footnote content")).not.toBeInTheDocument();
  });

  it("supports multiple independent footnotes", async () => {
    const user = userEvent.setup();
    const article = makeArticle(
      "First :footnote[detail one] and second :footnote[detail two] points.",
    );
    render(<ArticleEmbed article={article} />);

    const icons = screen.getAllByRole("img", { name: /footnote/i });
    expect(icons).toHaveLength(2);

    // Hover the first footnote
    await user.hover(icons[0].parentElement!);
    expect(screen.getByText("detail one")).toBeInTheDocument();
    expect(screen.queryByText("detail two")).not.toBeInTheDocument();
  });

  it("lens footnote trigger has data-source='lens'", () => {
    const article = makeArticle("Text :footnote[lens note] here.");
    render(<ArticleEmbed article={article} />);
    const trigger = screen
      .getByRole("img", { name: /footnote/i })
      .closest("[data-source]");
    expect(trigger).toHaveAttribute("data-source", "lens");
  });

  it("GFM footnote renders as tooltip trigger, not as <sup><a>", () => {
    const article = makeArticle(
      "Text with a ref[^1].\n\n[^1]: The definition text.",
    );
    render(<ArticleEmbed article={article} />);
    // Should NOT render default GFM footnote HTML
    expect(document.querySelector("sup")).not.toBeInTheDocument();
    expect(
      document.querySelector("section[data-footnotes]"),
    ).not.toBeInTheDocument();
    // Should render a tooltip trigger with the number
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("GFM footnote tooltip shows definition on hover", async () => {
    const user = userEvent.setup();
    const article = makeArticle(
      "Text[^1].\n\n[^1]: Author's footnote content.",
    );
    render(<ArticleEmbed article={article} />);
    const trigger = screen.getByText("1");
    await user.hover(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Author's footnote content.",
    );
  });

  it("GFM footnote trigger has data-source='author'", () => {
    const article = makeArticle("Text[^1].\n\n[^1]: Def.");
    render(<ArticleEmbed article={article} />);
    const trigger = screen.getByText("1").closest("[data-source]");
    expect(trigger).toHaveAttribute("data-source", "author");
  });

  it("opens on click and dismisses on click-outside (mobile)", async () => {
    const user = userEvent.setup();
    const article = makeArticle("Text :footnote[click info] more.");
    render(<ArticleEmbed article={article} />);

    const icon = screen.getByRole("img", { name: /footnote/i });

    // Click to open
    await user.click(icon.parentElement!);
    expect(screen.getByText("click info")).toBeInTheDocument();

    // Click outside to close
    await user.click(document.body);
    expect(screen.queryByText("click info")).not.toBeInTheDocument();
  });
});
