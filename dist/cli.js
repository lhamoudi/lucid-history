#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fetchDocument, createFolder, copyDocument } from './lucid.js';
import { normalize } from './normalize.js';
import { diff, isEmpty, changedPageIds, enrichLinesWithShapeText } from './diff.js';
import { summarizeDiff } from './summarize.js';
import { renderChangedPages, renderComparedPages } from './renders.js';
import { cloneOrOpen, commitAndPushBranch, openPullRequest, mergePullRequest } from './git.js';
async function ensureSubfolder(folderIdPath, docId, docTitle, parentFolderId) {
    try {
        const cached = JSON.parse(await readFile(folderIdPath, 'utf8'));
        return { folderId: cached.folderId, isNew: false };
    }
    catch {
        const safeName = docTitle.replace(/[/\\:*?"<>|]/g, '-').trim();
        const folderId = await createFolder(`${docId}_${safeName}`, parentFolderId);
        await mkdir(dirname(folderIdPath), { recursive: true });
        await writeFile(folderIdPath, JSON.stringify({ folderId }, null, 2) + '\n');
        return { folderId, isNew: true };
    }
}
const program = new Command();
program
    .name('lucid-history')
    .description('Daily-snapshot Lucidchart documents with AI-generated change summaries')
    .version('0.1.0');
program
    .command('fetch')
    .description('Fetch a Lucid document and write its JSON to a file')
    .argument('<doc-id>')
    .requiredOption('--out <path>', 'Output file path')
    .action(async (docId, opts) => {
    const doc = await fetchDocument(docId);
    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(opts.out, normalize(doc));
    console.log(`Wrote ${opts.out}`);
});
program
    .command('diff')
    .description('Diff two snapshot JSON files and print an AI-generated summary')
    .argument('<base>')
    .argument('<head>')
    .option('--raw', 'Print the DocDiff JSON instead of calling the summarizer')
    .action(async (baseP, headP, opts) => {
    const base = JSON.parse(await readFile(baseP, 'utf8'));
    const head = JSON.parse(await readFile(headP, 'utf8'));
    const d = enrichLinesWithShapeText(diff(base, head), head);
    if (opts.raw) {
        console.log(JSON.stringify(d, null, 2));
        return;
    }
    if (isEmpty(d)) {
        console.log('No material changes.');
        return;
    }
    console.log(await summarizeDiff(head.title, d));
});
program
    .command('compare')
    .description('Fetch two live Lucid documents and print an AI-generated summary of differences')
    .argument('<base-doc-id>', 'The older / restored document ID')
    .argument('<head-doc-id>', 'The current document ID')
    .option('--raw', 'Print the DocDiff JSON instead of calling the summarizer')
    .option('--skip-renders', 'Skip PNG exports', false)
    .option('--out <dir>', 'Directory to write PNGs into', './compare-output')
    .action(async (baseId, headId, opts) => {
    const [base, head] = await Promise.all([fetchDocument(baseId), fetchDocument(headId)]);
    const d = enrichLinesWithShapeText(diff(base, head), head);
    if (opts.raw) {
        console.log(JSON.stringify(d, null, 2));
        return;
    }
    if (isEmpty(d)) {
        console.log('No material changes.');
        return;
    }
    await rm(opts.out, { recursive: true, force: true });
    const [summary, renders] = await Promise.all([
        summarizeDiff(head.title, d),
        opts.skipRenders
            ? Promise.resolve([])
            : renderComparedPages({
                baseDocumentId: baseId,
                headDocumentId: headId,
                diff: d,
                outDir: opts.out,
            }),
    ]);
    await mkdir(opts.out, { recursive: true });
    const summaryPath = join(opts.out, 'summary.md');
    await writeFile(summaryPath, summary);
    console.log(summary);
    console.log(`\nWrote summary to ${summaryPath}`);
    if (renders.length > 0) {
        console.log(`Wrote ${renders.length} PNG(s) to ${join(opts.out, 'pages')}`);
    }
});
program
    .command('snapshot')
    .description('Fetch, diff vs latest, write snapshot + PNGs, and open a PR on the snapshots repo')
    .argument('<doc-id>')
    .requiredOption('--repo <owner/name>', 'GitHub owner/name of the private snapshots repo')
    .option('--local <path>', 'Local clone path', '/tmp/lucid-history-snapshots')
    .option('--dry-run', 'Skip git push and PR creation', false)
    .option('--skip-renders', 'Skip PNG exports (useful while Lucid PNG endpoint is unverified)', false)
    .option('--lucid-folder <id>', 'Lucid folder ID to save snapshot copies into (e.g. __AUTOMATED_SNAPSHOTS)')
    .option('--auto-merge', 'Automatically merge the PR after opening it', false)
    .action(async (docId, opts) => {
    const [owner, name] = opts.repo.split('/');
    console.log(`[${docId}] Cloning/opening snapshots repo...`);
    const git = await cloneOrOpen({ owner, name, localPath: opts.local });
    console.log(`[${docId}] Fetching document from Lucid...`);
    const doc = await fetchDocument(docId);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + 'Z';
    console.log(`[${doc.title}] Fetched — ${doc.pages.length} page(s)`);
    const docDir = join(opts.local, 'snapshots', docId);
    const jsonPath = join(docDir, 'json', `${timestamp}.json`);
    const latestPath = join(docDir, 'json', 'latest.json');
    const folderIdPath = join(docDir, '_lucid_snapshot_folder.json');
    let base = null;
    try {
        base = JSON.parse(await readFile(latestPath, 'utf8'));
        console.log(`[${doc.title}] Previous snapshot loaded`);
    }
    catch {
        base = null;
        console.log(`[${doc.title}] No previous snapshot found`);
    }
    await mkdir(dirname(jsonPath), { recursive: true });
    const normalized = normalize(doc);
    await writeFile(jsonPath, normalized);
    await writeFile(latestPath, normalized);
    async function takeLucidSnapshot() {
        if (!opts.lucidFolder)
            return { link: '', extraFiles: [] };
        const parentFolderId = parseInt(opts.lucidFolder, 10);
        console.log(`[${doc.title}] Copying document to Lucid __AUTOMATED_SNAPSHOTS...`);
        const { folderId, isNew } = await ensureSubfolder(folderIdPath, docId, doc.title, parentFolderId);
        const snapshotTitle = `SNAPSHOT_${timestamp.slice(0, 10)}_${doc.title}`;
        const copied = await copyDocument(docId, snapshotTitle, folderId, doc.product);
        console.log(`[${doc.title}] Lucid copy saved: ${copied.url}`);
        const link = `\n\n---\n\n**Lucid snapshot:** [${snapshotTitle}](${copied.url})`;
        return { link, extraFiles: isNew ? [folderIdPath] : [] };
    }
    if (!base) {
        console.log(`[${doc.title}] Initial snapshot — no diff available`);
        if (opts.dryRun)
            return;
        const { link, extraFiles } = await takeLucidSnapshot();
        const branch = `snapshot/${docId}/${timestamp}`;
        console.log(`[${doc.title}] Committing to branch ${branch}...`);
        await commitAndPushBranch(git, opts.local, branch, `chore: initial snapshot of ${doc.title}`, [
            jsonPath,
            latestPath,
            ...extraFiles,
        ]);
        console.log(`[${doc.title}] Opening PR...`);
        const { url, number } = await openPullRequest({
            owner,
            repo: name,
            head: branch,
            base: 'main',
            title: `Initial snapshot: ${doc.title}`,
            body: `Initial snapshot; no diff available.${link}`,
        });
        console.log(`[${doc.title}] PR opened: ${url}`);
        if (opts.autoMerge) {
            console.log(`[${doc.title}] Merging PR and deleting branch...`);
            await mergePullRequest({ owner, repo: name, pullNumber: number, branch });
            console.log(`[${doc.title}] Done.`);
        }
        return;
    }
    const d = enrichLinesWithShapeText(diff(base, doc), doc);
    if (isEmpty(d)) {
        console.log(`[${doc.title}] No material changes — skipping PR`);
        return;
    }
    const changedPages = changedPageIds(d);
    console.log(`[${doc.title}] ${changedPages.length} page(s) changed`);
    let renders = [];
    if (opts.skipRenders) {
        console.log(`[${doc.title}] Skipping PNG renders`);
    }
    else {
        console.log(`[${doc.title}] Rendering ${changedPages.length} page(s)...`);
        renders = await renderChangedPages({
            documentId: docId,
            changedPageIds: changedPages,
            pageTitles: new Map(doc.pages.map((p) => [p.id, p.title])),
            timestamp,
            renderDir: join(docDir, 'pages'),
        });
        console.log(`[${doc.title}] Rendered ${renders.length} PNG(s)`);
    }
    console.log(`[${doc.title}] Generating AI summary...`);
    let summary = await summarizeDiff(doc.title, d);
    if (opts.dryRun) {
        console.log(summary);
        return;
    }
    const { link, extraFiles } = await takeLucidSnapshot();
    summary += link;
    const dailyPath = join(docDir, 'daily', `${timestamp.slice(0, 10)}.md`);
    await mkdir(dirname(dailyPath), { recursive: true });
    await writeFile(dailyPath, summary);
    const branch = `snapshot/${docId}/${timestamp}`;
    console.log(`[${doc.title}] Committing to branch ${branch}...`);
    await commitAndPushBranch(git, opts.local, branch, `chore: snapshot ${doc.title} @ ${timestamp}`, [jsonPath, latestPath, dailyPath, ...renders, ...extraFiles]);
    console.log(`[${doc.title}] Opening PR...`);
    const { url, number } = await openPullRequest({
        owner,
        repo: name,
        head: branch,
        base: 'main',
        title: `${doc.title}: ${changedPages.length} page(s) changed`,
        body: summary,
    });
    console.log(`[${doc.title}] PR opened: ${url}`);
    if (opts.autoMerge) {
        console.log(`[${doc.title}] Merging PR and deleting branch...`);
        await mergePullRequest({ owner, repo: name, pullNumber: number, branch });
        console.log(`[${doc.title}] Done.`);
    }
});
program.parseAsync();
//# sourceMappingURL=cli.js.map