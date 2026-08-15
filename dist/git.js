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
    const log = await git.log(['-1']);
    return log.latest.hash;
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
// GitHub's merge endpoint returns 405 for two very different situations that share
// nothing but the status code:
//  - "Base branch was modified" — the backend hasn't finished propagating a very
//    recent merge to all replicas yet. Nothing is actually wrong; retrying the same
//    call shortly after succeeds once propagation catches up.
//  - "...merge conflict..." (also raised as 405 by this endpoint) — base has moved
//    since the PR's branch was cut and the two now have genuinely conflicting
//    content. Retrying the same call can never succeed; the branch itself needs to
//    be brought up to date with base first.
export function classifyMergeError(err) {
    if (err?.status !== 405)
        return 'other';
    const message = err?.response?.data?.message ?? err?.message ?? '';
    if (/base branch was modified/i.test(message))
        return 'stale-base';
    if (/merge conflict/i.test(message))
        return 'real-conflict';
    return 'other';
}
async function mergeOnce(octokit, opts) {
    const MAX_STALE_RETRIES = 4;
    for (let attempt = 1; attempt <= MAX_STALE_RETRIES; attempt++) {
        try {
            await octokit.pulls.merge({
                owner: opts.owner,
                repo: opts.repo,
                pull_number: opts.pullNumber,
                merge_method: 'squash',
            });
            return 'merged';
        }
        catch (err) {
            const kind = classifyMergeError(err);
            if (kind === 'stale-base' && attempt < MAX_STALE_RETRIES) {
                const delay = attempt * 3000;
                console.log(`Merge attempt ${attempt} got a stale-base 405 — retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            if (kind === 'real-conflict')
                return 'real-conflict';
            throw err;
        }
    }
    // Base never settled after the full stale-base retry budget — treat like a real
    // conflict so the caller falls back to updating the branch instead of giving up.
    return 'real-conflict';
}
async function updateBranchAndWaitUntilSettled(octokit, owner, repo, pullNumber) {
    await octokit.pulls.updateBranch({ owner, repo, pull_number: pullNumber });
    // updateBranch resolves once GitHub *accepts* the request, not once the merge it
    // triggers has actually landed — poll mergeable_state until it settles so the
    // follow-up merge attempt isn't racing the update itself.
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
        if (pr.mergeable_state !== 'unknown')
            return;
    }
}
export async function mergePullRequest(opts) {
    const octokit = new Octokit({ auth: opts.token ?? process.env.GITHUB_TOKEN });
    // A real conflict usually means another snapshot PR (for a different tracked doc,
    // sharing files like copy-registry.json) squash-merged into base moments earlier.
    // Updating this branch from base resolves that automatically in the common case
    // where the two PRs touch different content; only a handful of rounds are allowed
    // before giving up, so a genuinely unresolvable conflict still surfaces loudly
    // instead of retrying forever.
    const MAX_UPDATE_ATTEMPTS = 2;
    for (let round = 0; round <= MAX_UPDATE_ATTEMPTS; round++) {
        const result = await mergeOnce(octokit, opts);
        if (result === 'merged') {
            if (opts.branch) {
                await octokit.git.deleteRef({
                    owner: opts.owner,
                    repo: opts.repo,
                    ref: `heads/${opts.branch}`,
                });
            }
            return;
        }
        if (round === MAX_UPDATE_ATTEMPTS) {
            throw new Error(`PR #${opts.pullNumber} has real merge conflicts with base that didn't resolve after ` +
                `${MAX_UPDATE_ATTEMPTS} branch-update attempt(s). Leaving the PR and branch open for manual resolution.`);
        }
        console.log(`PR #${opts.pullNumber} has a real conflict against base (round ${round + 1}/${MAX_UPDATE_ATTEMPTS}) — ` +
            `updating branch from base and retrying...`);
        await updateBranchAndWaitUntilSettled(octokit, opts.owner, opts.repo, opts.pullNumber);
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