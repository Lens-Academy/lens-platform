// web_frontend/src/components/module/ArticleSectionContext.tsx

import { createContext, useContext } from "react";

type ArticleSectionContextValue = {
  /** Get unique heading ID - shared counter across all ArticleEmbed instances */
  getHeadingId: (text: string) => string;
  /** Register pre-computed heading IDs from extractAllHeadings */
  registerHeadingIds: (headings: Array<{ id: string; text: string }>) => void;
  onHeadingRender: (id: string, element: HTMLElement) => void;
  /** Register a ToC item element for direct DOM updates (bypasses React re-renders) */
  registerTocItem: (id: string, index: number, element: HTMLElement) => void;
  onHeadingClick: (id: string) => void;
  /** Portal container for rendering the TOC in a grid column at the Module level */
  tocPortalContainer: HTMLElement | null;
};

const ArticleSectionContext = createContext<ArticleSectionContextValue | null>(
  null,
);

export function useArticleSectionContext() {
  return useContext(ArticleSectionContext);
}

export const ArticleSectionProvider = ArticleSectionContext.Provider;
