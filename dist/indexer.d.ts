import type { PageDiff } from './types.js';
export type PageTitleRange = {
    from: string | null;
    to: string | null;
    title: string;
};
export type PageHistoryEntry = {
    timestamp: string;
    renderFilename: string | null;
    summary: string;
};
export declare function renderPageHistory(pageId: string, currentTitle: string, titleHistory: PageTitleRange[], entries: PageHistoryEntry[]): string;
export type DocIndexEntry = {
    id: string;
    currentTitle: string;
    firstSeen: string;
    lastChanged: string;
    renderCount: number;
};
export declare function renderDocIndex(docId: string, docTitle: string, pages: DocIndexEntry[]): string;
export declare function summarizeDiffForPage(pd: PageDiff): string;
