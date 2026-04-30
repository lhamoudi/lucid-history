import type { LucidDocument } from './types.js';
export declare function createFolder(name: string, parentId: number, apiKey?: string | undefined): Promise<number>;
export declare function copyDocument(sourceId: string, title: string, parentFolderId: number, apiKey?: string | undefined): Promise<{
    id: string;
    url: string;
}>;
export declare function fetchDocument(documentId: string, apiKey?: string | undefined): Promise<LucidDocument>;
export declare function exportPagePng(documentId: string, pageId: string, apiKey?: string | undefined): Promise<Uint8Array>;
