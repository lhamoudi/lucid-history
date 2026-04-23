import type { LucidDocument, DocDiff } from './types.js';
export declare function diff(base: LucidDocument, head: LucidDocument): DocDiff;
export declare function isEmpty(d: DocDiff): boolean;
export declare function changedPageIds(d: DocDiff): string[];
export declare function enrichLinesWithShapeText(d: DocDiff, head: LucidDocument): DocDiff;
