import { type SimpleGit } from 'simple-git';
export type SnapshotsRepo = {
    owner: string;
    name: string;
    localPath: string;
};
export declare function cloneOrOpen(repo: SnapshotsRepo, token?: string | undefined): Promise<SimpleGit>;
export declare function commitAndPushBranch(git: SimpleGit, localPath: string, branch: string, message: string, files: string[]): Promise<string>;
export declare function openPullRequest(opts: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    token?: string;
}): Promise<{
    url: string;
    number: number;
}>;
export declare function mergePullRequest(opts: {
    owner: string;
    repo: string;
    pullNumber: number;
    branch?: string;
    token?: string;
}): Promise<void>;
