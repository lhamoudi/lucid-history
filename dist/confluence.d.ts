type Auth = {
    email: string;
    token: string;
};
type PageMeta = {
    id: string;
    version: number;
};
export declare function findPage(spaceKey: string, title: string, baseUrl: string, auth: Auth): Promise<PageMeta | null>;
export declare function createPage(spaceKey: string, parentId: string, title: string, body: string, baseUrl: string, auth: Auth): Promise<string>;
export declare function updatePage(pageId: string, title: string, body: string, version: number, baseUrl: string, auth: Auth): Promise<void>;
export declare function upsertPage(spaceKey: string, parentId: string, title: string, body: string, baseUrl: string, auth: Auth): Promise<string>;
export declare function findChildPage(parentId: string, title: string, baseUrl: string, auth: Auth): Promise<PageMeta | null>;
export declare function upsertChildPage(spaceKey: string, parentId: string, title: string, body: string, baseUrl: string, auth: Auth): Promise<string>;
export declare function getPageParentId(pageId: string, baseUrl: string, auth: Auth): Promise<string | null>;
export declare function movePage(pageId: string, newParentId: string, spaceKey: string, baseUrl: string, auth: Auth): Promise<void>;
export type SnapshotImage = {
    filename: string;
    data: Buffer;
};
export declare function uploadAttachment(pageId: string, filename: string, data: Buffer, baseUrl: string, auth: Auth): Promise<void>;
export declare function createSnapshotPage(spaceKey: string, docPageId: string, title: string, summaryMd: string, images: SnapshotImage[], baseUrl: string, auth: Auth): Promise<string>;
export declare function markdownToStorage(md: string): string;
export declare function absolutifyLinks(md: string, baseGithubUrl: string): string;
export {};
