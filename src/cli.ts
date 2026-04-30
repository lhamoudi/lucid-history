#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fetchDocument, copyDocument } from './lucid.js';
import { normalize } from './normalize.js';
import { diff, isEmpty, changedPageIds, enrichLinesWithShapeText } from './diff.js';
import { summarizeDiff } from './summarize.js';
import { renderChangedPages, renderComparedPages, type PageRender } from './renders.js';
import { cloneOrOpen, commitAndPushBranch, openPullRequest, mergePullRequest } from './git.js';
import type { LucidDocument } from './types.js';


function buildImageSection(renders: Array<{ pageTitle: string; beforeUrl: string | null; afterUrl: string }>): string {
  if (renders.length === 0) return '';
  const sections = renders.map(({ pageTitle, beforeUrl, afterUrl }) => {
    const before = beforeUrl ? `![${pageTitle} — before](${beforeUrl})` : '*(no prior render)*';
    const after = `![${pageTitle} — after](${afterUrl})`;
    return `### ${pageTitle}\n\n| Before | After |\n|:---:|:---:|\n| ${before} | ${after} |`;
  });
  return `\n\n---\n\n## Page renders\n\n${sections.join('\n\n')}`;
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
  .action(async (docId: string, opts: { out: string }) => {
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
  .action(async (baseP: string, headP: string, opts: { raw?: boolean }) => {
    const base = JSON.parse(await readFile(baseP, 'utf8')) as LucidDocument;
    const head = JSON.parse(await readFile(headP, 'utf8')) as LucidDocument;
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
  .action(
    async (
      baseId: string,
      headId: string,
      opts: { raw?: boolean; skipRenders: boolean; out: string },
    ) => {
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
          ? Promise.resolve([] as string[])
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
    },
  );

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
  .action(
    async (
      docId: string,
      opts: { repo: string; local: string; dryRun: boolean; skipRenders: boolean; lucidFolder?: string; autoMerge: boolean },
    ) => {
      const [owner, name] = opts.repo.split('/');

      console.log(`[${docId}] Cloning/opening snapshots repo...`);
      const git = await cloneOrOpen({ owner, name, localPath: opts.local });

      console.log(`[${docId}] Fetching document from Lucid...`);
      const doc = await fetchDocument(docId);
      const timestamp =
        new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + 'Z';
      console.log(`[${doc.title}] Fetched — ${doc.pages.length} page(s)`);

      const safeTitle = doc.title.replace(/[/\\:]/g, '-');
      const docDir = join(opts.local, 'snapshots', `${docId}_${safeTitle}`);
      const jsonPath = join(docDir, 'json', `${timestamp}.json`);
      const latestPath = join(docDir, 'json', 'latest.json');

      let base: LucidDocument | null = null;
      try {
        base = JSON.parse(await readFile(latestPath, 'utf8'));
        console.log(`[${doc.title}] Previous snapshot loaded`);
      } catch {
        base = null;
        console.log(`[${doc.title}] No previous snapshot found`);
      }

      await mkdir(dirname(jsonPath), { recursive: true });
      const normalized = normalize(doc);
      await writeFile(jsonPath, normalized);
      await writeFile(latestPath, normalized);

      async function takeLucidSnapshot(): Promise<{ link: string }> {
        if (!opts.lucidFolder) return { link: '' };
        const folderId = parseInt(opts.lucidFolder, 10);
        console.log(`[${doc.title}] Copying document to Lucid __AUTOMATED_SNAPSHOTS...`);
        const snapshotTitle = `SNAPSHOT_${doc.title}_${timestamp.slice(0, 10)}`;
        try {
          const copied = await copyDocument(docId, snapshotTitle, folderId);
          console.log(`[${doc.title}] Lucid copy saved: ${copied.url}`);
          return { link: `\n\n---\n\n**Lucid snapshot:** [${snapshotTitle}](${copied.url})` };
        } catch (err) {
          console.warn(`[${doc.title}] Warning: Lucid copy skipped — ${(err as Error).message}`);
          return { link: '' };
        }
      }

      if (!base) {
        console.log(`[${doc.title}] Initial snapshot — no diff available`);
        if (opts.dryRun) return;
        const { link } = await takeLucidSnapshot();
        const branch = `snapshot/${docId}/${timestamp}`;
        console.log(`[${doc.title}] Committing to branch ${branch}...`);
        await commitAndPushBranch(git, opts.local, branch, `chore: initial snapshot of ${doc.title}`, [
          jsonPath,
          latestPath,
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

      let renders: PageRender[] = [];
      if (opts.skipRenders) {
        console.log(`[${doc.title}] Skipping PNG renders`);
      } else {
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

      const { link } = await takeLucidSnapshot();
      summary += link;

      const snapshotDir = join(docDir, timestamp);
      const summaryPath = join(snapshotDir, 'summary.md');
      const relativeImageSection = buildImageSection(
        renders.map(({ pageTitle, before, after }) => ({
          pageTitle,
          beforeUrl: before ? relative(snapshotDir, before) : null,
          afterUrl: relative(snapshotDir, after),
        })),
      );
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(summaryPath, summary + relativeImageSection);

      const branch = `snapshot/${docId}/${timestamp}`;
      console.log(`[${doc.title}] Committing to branch ${branch}...`);
      const sha = await commitAndPushBranch(
        git,
        opts.local,
        branch,
        `chore: snapshot ${doc.title} @ ${timestamp}`,
        [jsonPath, latestPath, summaryPath, ...renders.map((r) => r.after)],
      );

      // PR body uses absolute SHA-based URLs so images survive branch deletion.
      const rawBase = `https://raw.githubusercontent.com/${owner}/${name}/${sha}`;
      const absoluteImageSection = buildImageSection(
        renders.map(({ pageTitle, before, after }) => ({
          pageTitle,
          beforeUrl: before ? `${rawBase}/${relative(opts.local, before)}` : null,
          afterUrl: `${rawBase}/${relative(opts.local, after)}`,
        })),
      );

      console.log(`[${doc.title}] Opening PR...`);
      const { url, number } = await openPullRequest({
        owner,
        repo: name,
        head: branch,
        base: 'main',
        title: `${doc.title}: ${changedPages.length} page(s) changed`,
        body: summary + absoluteImageSection,
      });
      console.log(`[${doc.title}] PR opened: ${url}`);
      if (opts.autoMerge) {
        console.log(`[${doc.title}] Merging PR and deleting branch...`);
        await mergePullRequest({ owner, repo: name, pullNumber: number, branch });
        console.log(`[${doc.title}] Done.`);
      }
    },
  );

program.parseAsync();
