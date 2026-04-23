import type { LucidDocument } from './types.js';
export declare function fetchDocument(documentId: string, apiKey?: string | undefined): Promise<LucidDocument>;
export declare function exportPagePng(documentId: string, pageId: string, apiKey?: string | undefined): Promise<Uint8Array>;
