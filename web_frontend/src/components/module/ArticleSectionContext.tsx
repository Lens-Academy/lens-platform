// web_frontend/src/components/module/ArticleSectionContext.tsx

import { createContext, useContext } from "react";

type ArticleSectionContextValue = {
  /** Get unique heading ID - shared counter across all ArticleEmbed instances */
  getHeadingId: (text: string) => string;
  /** Register pre-computed heading IDs from extractAllHeadings */
  registerHeadingIds: (headings: Array<{ id: string; text: string }>) => void;
  onHeadingRender: (id: string, element: HTMLElement) => void;
  passedHeadingIds: Set<string>;
  onHeadingClick: (id: string) => void;
};

const ArticleSectionContext = createContext<ArticleSectionContextValue | null>(
  null
);

export function useArticleSectionContext() {
  return useContext(ArticleSectionContext);
}

export const ArticleSectionProvider = ArticleSectionContext.Provider;
