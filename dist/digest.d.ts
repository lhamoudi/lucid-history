export type SnapshotRange = {
    title: string;
    docFolder: string;
    /** Most recent snapshot taken strictly before the week window. Null if none exists. */
    baselineTs: string | null;
    /** Most recent snapshot taken within the week window. Null if no activity this week. */
    headTs: string | null;
};
export declare function getWeekRange(ref: Date): {
    start: Date;
    end: Date;
};
export declare function findDigestRanges(local: string, ref: Date): Promise<SnapshotRange[]>;
