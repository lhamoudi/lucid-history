import type { DocDiff, PageDiff } from './types.js';
export declare function isDateOnlyChange(pd: PageDiff): boolean;
export type PageRender = {
    pageTitle: string;
    before: string | null;
    after: string;
};
export declare function renderChangedPages(opts: {
    documentId: string;
    changedPageIds: string[];
    pageTitles: Map<string, string>;
    timestamp: string;
    runDir: string;
    docDir: string;
}): Promise<PageRender[]>;
export declare function renderComparedPages(opts: {
    baseDocumentId: string;
    headDocumentId: string;
    diff: DocDiff;
    outDir: string;
}): Promise<string[]>;
