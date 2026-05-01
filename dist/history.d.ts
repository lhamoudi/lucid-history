export type HistoryEntry = {
    timestamp: string;
    summary: string;
    pagesAdded: string[];
    pagesChanged: string[];
    pagesRemoved: string[];
    lucidUrl?: string;
};
export declare function appendHistoryEntry(docDir: string, entry: HistoryEntry): Promise<void>;
