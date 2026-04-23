import { type SimpleGit } from 'simple-git';
export type SnapshotsRepo = {
    owner: string;
    name: string;
    localPath: string;
};
export declare function cloneOrOpen(repo: SnapshotsRepo, token?: string | undefined): Promise<SimpleGit>;
export declare function commitAndPushBranch(git: SimpleGit, localPath: string, branch: string, message: string, files: string[]): Promise<void>;
export declare function openPullRequest(opts: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    token?: string;
}): Promise<string>;
