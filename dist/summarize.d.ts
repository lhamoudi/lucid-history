import type { DocDiff } from './types.js';
export declare function summarizeDiff(docTitle: string, diff: DocDiff, opts?: {
    apiKey?: string;
    model?: string;
}): Promise<string>;
