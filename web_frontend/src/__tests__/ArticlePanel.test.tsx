// web_frontend/src/__tests__/ArticlePanel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ArticlePanel from "../components/unified-lesson/ArticlePanel";

describe("ArticlePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets scroll position to top when article content changes", async () => {
    const longContent = "First article.\n\n" + "Paragraph.\n\n".repeat(50);
    const newContent = "Second article - completely different content.\n\n" + "New paragraph.\n\n".repeat(50);

    const { rerender, container } = render(
      <ArticlePanel
        article={{ content: longContent, title: "Article 1" }}
      />
    );

    // Find the scroll container (the div with overflow-y-auto)
    const scrollContainer = container.querySelector('[class*="overflow-y-auto"]');
    expect(scrollContainer).toBeTruthy();

    // Simulate scrolling down
    if (scrollContainer) {
      // Set scroll position
      Object.defineProperty(scrollContainer, 'scrollTop', {
        writable: true,
        configurable: true,
        value: 500,
      });
      Object.defineProperty(scrollContainer, 'scrollHeight', {
        writable: true,
        configurable: true,
        value: 2000,
      });
      Object.defineProperty(scrollContainer, 'clientHeight', {
        writable: true,
        configurable: true,
        value: 400,
      });
    }

    // Verify we're scrolled down
    expect(scrollContainer?.scrollTop).toBe(500);

    // Change the article content
    rerender(
      <ArticlePanel
        article={{ content: newContent, title: "Article 2" }}
      />
    );

    // After content change, scroll should be reset to top
    // This test will FAIL with the current implementation (no scroll reset)
    expect(scrollContainer?.scrollTop).toBe(0);
  });

  it("displays article title and content", () => {
    render(
      <ArticlePanel
        article={{ content: "Test content here", title: "Test Title" }}
      />
    );

    expect(screen.getByText("Test Title")).toBeInTheDocument();
    expect(screen.getByText("Test content here")).toBeInTheDocument();
  });

  it("displays author and source link when provided", () => {
    render(
      <ArticlePanel
        article={{
          content: "Content",
          title: "Title",
          author: "John Doe",
          sourceUrl: "https://example.com/article",
        }}
      />
    );

    expect(screen.getByText(/By John Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Read original/)).toBeInTheDocument();
  });
});
