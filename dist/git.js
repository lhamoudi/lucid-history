import { access, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { simpleGit } from 'simple-git';
import { Octokit } from '@octokit/rest';
function gitPush(localPath, branch) {
    // http.postBuffer must exceed the pack size; default 1 MiB triggers chunked
    // transfer encoding which GitHub rejects with HTTP 400 for large snapshots.
    execFileSync('git', ['-c', 'http.postBuffer=104857600', 'push', '--set-upstream', 'origin', branch], {
        cwd: localPath,
        stdio: 'inherit',
    });
}
export async function cloneOrOpen(repo, token = process.env.GITHUB_TOKEN) {
    const url = token
        ? `https://${token.trim()}@github.com/${repo.owner}/${repo.name}.git`
        : `https://github.com/${repo.owner}/${repo.name}.git`;
    if (await exists(repo.localPath)) {
        try {
            const git = simpleGit(repo.localPath);
            await git.remote(['set-url', 'origin', url]);
            await git.fetch();
            await git.checkout('main');
            await git.pull('origin', 'main');
            return git;
        }
        catch {
            await rm(repo.localPath, { recursive: true, force: true });
        }
    }
    await simpleGit().clone(url, repo.localPath);
    const git = simpleGit(repo.localPath);
    await ensureMain(git, repo.localPath);
    return git;
}
export async function commitAndPushBranch(git, localPath, branch, message, files) {
    await git.checkoutLocalBranch(branch);
    for (const f of files)
        await git.add(f);
    await git.commit(message);
    gitPush(localPath, branch);
}
export async function openPullRequest(opts) {
    const octokit = new Octokit({ auth: opts.token ?? process.env.GITHUB_TOKEN });
    const pr = await octokit.pulls.create({
        owner: opts.owner,
        repo: opts.repo,
        head: opts.head,
        base: opts.base,
        title: opts.title,
        body: opts.body,
    });
    return { url: pr.data.html_url, number: pr.data.number };
}
export async function mergePullRequest(opts) {
    const octokit = new Octokit({ auth: opts.token ?? process.env.GITHUB_TOKEN });
    await octokit.pulls.merge({
        owner: opts.owner,
        repo: opts.repo,
        pull_number: opts.pullNumber,
        merge_method: 'squash',
    });
    if (opts.branch) {
        await octokit.git.deleteRef({
            owner: opts.owner,
            repo: opts.repo,
            ref: `heads/${opts.branch}`,
        });
    }
}
async function ensureMain(git, localPath) {
    const remotes = await git.branch(['-r']);
    if (remotes.all.some(b => b.includes('origin/main'))) {
        await git.checkout('main');
        return;
    }
    // Empty repo — create main with an initial empty commit so PRs have a base.
    await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await git.raw(['commit', '--allow-empty', '-m', 'chore: initialize snapshots repository']);
    gitPush(localPath, 'main');
}
async function exists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=git.js.map