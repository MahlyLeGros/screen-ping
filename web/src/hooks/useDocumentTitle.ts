import { useEffect } from "react";

const SITE_NAME = "Screen Ping";
export const SITE_SEARCH_TITLE = "Screen Ping — Send media to your friends' screens";

export function useDocumentTitle(pageTitle: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = pageTitle ? `${pageTitle} — ${SITE_NAME}` : SITE_SEARCH_TITLE;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);
}
