// web_frontend_next/src/components/module/ArticleSectionContext.tsx

import { createContext, useContext } from "react";

type ArticleSectionContextValue = {
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
