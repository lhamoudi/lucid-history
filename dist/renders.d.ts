import type { DocDiff } from './types.js';
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
    renderDir: string;
}): Promise<PageRender[]>;
export declare function renderComparedPages(opts: {
    baseDocumentId: string;
    headDocumentId: string;
    diff: DocDiff;
    outDir: string;
}): Promise<string[]>;
