export type HistoryRow = {
    timestamp: string;
    isoDate: string;
    folderTimestamp: string;
    pagesAdded: number;
    pagesChanged: number;
    pagesRemoved: number;
    affectedPages: string;
    theme: string;
};
export type DocDigest = {
    title: string;
    docFolder: string;
    rows: HistoryRow[];
};
export declare function parseHistoryRows(historyMd: string): HistoryRow[];
export declare function getWeekRange(ref: Date): {
    start: Date;
    end: Date;
};
export declare function compileDigest(local: string, ref: Date): Promise<DocDigest[]>;
