import type { DocDiff } from './types.js';
export declare function renderChangedPages(opts: {
    documentId: string;
    changedPageIds: string[];
    pageTitles: Map<string, string>;
    timestamp: string;
    renderDir: string;
}): Promise<string[]>;
export declare function renderComparedPages(opts: {
    baseDocumentId: string;
    headDocumentId: string;
    diff: DocDiff;
    outDir: string;
}): Promise<string[]>;
