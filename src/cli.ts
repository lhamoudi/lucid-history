#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fetchDocument, copyDocument } from './lucid.js';
import { normalize } from './normalize.js';
import { diff, isEmpty, changedPageIds, enrichLinesWithShapeText } from './diff.js';
import { summarizeDiff } from './summarize.js';
import { renderChangedPages, renderComparedPages, isDateOnlyChange, type PageRender } from './renders.js';
import { cloneOrOpen, commitAndPushBranch, openPullRequest, mergePullRequest } from './git.js';
import { appendHistoryEntry } from './history.js';
import { compileDigest, getWeekRange, type DocDigest } from './digest.js';
import { upsertPage, markdownToStorage, absolutifyLinks } from './confluence.js';
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
      const substantiveD = { ...d, perPage: d.perPage.filter(pd => !isDateOnlyChange(pd)) };
      if (isEmpty(substantiveD)) {
        console.log('No material changes.');
        return;
      }
      await rm(opts.out, { recursive: true, force: true });
      const [summary, renders] = await Promise.all([
        summarizeDiff(head.title, substantiveD),
        opts.skipRenders
          ? Promise.resolve([] as string[])
          : renderComparedPages({
              baseDocumentId: baseId,
              headDocumentId: headId,
              diff: substantiveD,
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

      const safeTitle = doc.title.replace(/[^a-zA-Z0-9_-]/g, '_');
      // Locate the doc folder by stable ID so renames don't orphan history.
      const snapshotsRoot = join(opts.local, 'snapshots');
      const existingDocFolder = await readdir(snapshotsRoot, { withFileTypes: true })
        .then(entries => entries.find(d => d.isDirectory() && d.name.endsWith(`___${docId}`))?.name)
        .catch(() => undefined);
      const docDir = join(snapshotsRoot, existingDocFolder ?? `${safeTitle}___${docId}`);
      const snapshotDir = join(docDir, timestamp);
      const jsonPath = join(snapshotDir, 'snapshot.json');
      const latestPath = join(docDir, 'latest.json');

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

      async function takeLucidSnapshot(): Promise<{ link: string; url: string }> {
        if (!opts.lucidFolder) return { link: '', url: '' };
        const folderId = parseInt(opts.lucidFolder, 10);
        console.log(`[${doc.title}] Copying document to Lucid __AUTOMATED_SNAPSHOTS...`);
        const snapshotTitle = `SNAPSHOT_${doc.title}_${timestamp.slice(0, 10)} ${timestamp.slice(11, 13)}:${timestamp.slice(14, 16)}`;
        try {
          const copied = await copyDocument(docId, snapshotTitle, folderId);
          console.log(`[${doc.title}] Lucid copy saved: ${copied.url}`);
          return {
            link: `\n\n---\n\n**Lucid snapshot:** [${snapshotTitle}](${copied.url})`,
            url: copied.url,
          };
        } catch (err) {
          console.warn(`[${doc.title}] Warning: Lucid copy skipped — ${(err as Error).message}`);
          return { link: '', url: '' };
        }
      }

      if (!base) {
        console.log(`[${doc.title}] Initial snapshot — no prior state`);
        if (opts.dryRun) return;

        let renders: PageRender[] = [];
        if (opts.skipRenders) {
          console.log(`[${doc.title}] Skipping PNG renders`);
        } else {
          const allPageIds = doc.pages.map((p) => p.id);
          console.log(`[${doc.title}] Rendering ${allPageIds.length} page(s) as baseline...`);
          renders = await renderChangedPages({
            documentId: docId,
            changedPageIds: allPageIds,
            pageTitles: new Map(doc.pages.map((p) => [p.id, p.title])),
            timestamp,
            runDir: snapshotDir,
            docDir,
          });
          console.log(`[${doc.title}] Rendered ${renders.length} PNG(s)`);
        }

        const { link, url: lucidUrl } = await takeLucidSnapshot();
        const summaryPath = join(snapshotDir, 'summary.md');
        const historyPath = join(docDir, 'HISTORY.md');
        const initialSummaryText = `Initial snapshot; no prior state to diff.`;
        await writeFile(summaryPath, `${initialSummaryText}${link}`);
        await appendHistoryEntry(docDir, {
          timestamp,
          summary: initialSummaryText,
          pagesAdded: doc.pages.map((p) => p.title),
          pagesChanged: [],
          pagesRemoved: [],
          lucidUrl: lucidUrl || undefined,
        });

        const branch = `snapshot/${docId}/${timestamp}`;
        console.log(`[${doc.title}] Committing to branch ${branch}...`);
        await commitAndPushBranch(
          git, opts.local, branch,
          `chore: initial snapshot of ${doc.title}`,
          [jsonPath, latestPath, summaryPath, historyPath, ...renders.map((r) => r.after)],
        );

        console.log(`[${doc.title}] Opening PR...`);
        const { url, number } = await openPullRequest({
          owner,
          repo: name,
          head: branch,
          base: 'main',
          title: `Initial snapshot: ${doc.title}`,
          body: `Initial snapshot; no prior state to diff.${link}`,
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
      const substantiveD = { ...d, perPage: d.perPage.filter(pd => !isDateOnlyChange(pd)) };
      if (isEmpty(substantiveD)) {
        console.log(`[${doc.title}] Date-only changes — skipping PR`);
        return;
      }

      const changedPages = changedPageIds(substantiveD);
      console.log(`[${doc.title}] ${changedPages.length} page(s) changed`);

      console.log(`[${doc.title}] Generating AI summary...`);
      let summary = await summarizeDiff(doc.title, substantiveD);

      if (opts.dryRun) {
        console.log(summary);
        return;
      }

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
          runDir: snapshotDir,
          docDir,
        });
        console.log(`[${doc.title}] Rendered ${renders.length} PNG(s)`);
      }

      const { link, url: lucidUrl } = await takeLucidSnapshot();
      summary += link;

      const summaryPath = join(snapshotDir, 'summary.md');
      const historyPath = join(docDir, 'HISTORY.md');
      const relativeImageSection = buildImageSection(
        renders.map(({ pageTitle, before, after }) => ({
          pageTitle,
          beforeUrl: before ? relative(snapshotDir, before) : null,
          afterUrl: relative(snapshotDir, after),
        })),
      );
      await mkdir(snapshotDir, { recursive: true });
      await writeFile(summaryPath, summary + relativeImageSection);
      await appendHistoryEntry(docDir, {
        timestamp,
        summary,
        pagesAdded: substantiveD.pagesAdded.map((p) => p.title),
        pagesChanged: substantiveD.perPage.map((pd) => pd.page.title),
        pagesRemoved: substantiveD.pagesRemoved.map((p) => p.title),
        lucidUrl: lucidUrl || undefined,
      });

      const branch = `snapshot/${docId}/${timestamp}`;
      console.log(`[${doc.title}] Committing to branch ${branch}...`);
      const sha = await commitAndPushBranch(
        git,
        opts.local,
        branch,
        `chore: snapshot ${doc.title} @ ${timestamp}`,
        [jsonPath, latestPath, summaryPath, historyPath, ...renders.map((r) => r.after)],
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

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(d: Date): string {
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

type DigestFormatOpts = { start: Date; end: Date; owner: string; repo: string };

function digestWeekLabel(start: Date): string {
  const sunday = new Date(start);
  sunday.setUTCDate(start.getUTCDate() + 6);
  return `Week of ${shortDate(start)} – ${shortDate(sunday)}, ${start.getUTCFullYear()}`;
}

function digestRowUrl(doc: DocDigest, row: { folderTimestamp: string }, owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}/blob/main/snapshots/${doc.docFolder}/${row.folderTimestamp}/summary.md`;
}

function formatMarkdownDigest(digests: DocDigest[], opts: DigestFormatOpts): string {
  const sections = digests.map(doc => {
    const title = `## ${doc.title}`;
    if (doc.rows.length === 0) return `${title}\n\n_No changes this week._`;

    const bullets = doc.rows.map(row => {
      const d = new Date(row.isoDate + 'T00:00:00Z');
      const time = row.timestamp.slice(11, 16);
      const dateLine = `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${time}`;
      const counts = `+${row.pagesAdded} ~${row.pagesChanged} −${row.pagesRemoved}`;
      const pages = row.affectedPages || '—';
      const url = digestRowUrl(doc, row, opts.owner, opts.repo);
      return `- **${dateLine}** — ${counts} · ${pages}\n  ${row.theme} [Summary](${url})`;
    });

    return `${title}\n\n${bullets.join('\n')}`;
  });

  return `# ${digestWeekLabel(opts.start)} — Lucidchart Diagram Digest\n\n${sections.join('\n\n')}`;
}

function formatSlackDigest(digests: DocDigest[], opts: DigestFormatOpts): string {
  const sections = digests.map(doc => {
    const title = `*${doc.title}*`;
    if (doc.rows.length === 0) return `${title}\n_No changes this week._`;

    const bullets = doc.rows.map(row => {
      const d = new Date(row.isoDate + 'T00:00:00Z');
      const time = row.timestamp.slice(11, 16);
      const dateLine = `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${time}`;
      const counts = `+${row.pagesAdded} ~${row.pagesChanged} −${row.pagesRemoved}`;
      const pages = row.affectedPages || '—';
      const url = digestRowUrl(doc, row, opts.owner, opts.repo);
      return `• *${dateLine}* — ${counts} · ${pages}\n  ${row.theme} <${url}|Summary>`;
    });

    return `${title}\n${bullets.join('\n')}`;
  });

  return `*${digestWeekLabel(opts.start)} — Lucidchart Diagram Digest*\n\n${sections.join('\n\n')}`;
}

program
  .command('weekly-digest')
  .description('Compile a weekly digest of diagram changes; post to Slack and/or write to a file')
  .requiredOption('--repo <owner/name>', 'GitHub snapshots repo slug (for summary links)')
  .option('--local <path>', 'Local snapshots repo path', '.')
  .option('--slack-webhook <url>', 'Slack incoming webhook URL')
  .option('--out <file>', 'Write the digest as a Markdown file')
  .option('--week <YYYY-MM-DD>', 'Any date in the week to digest (default: today)')
  .option('--dry-run', 'Print the digest without posting or writing', false)
  .action(async (opts: { repo: string; local: string; slackWebhook?: string; out?: string; week?: string; dryRun: boolean }) => {
    if (!opts.dryRun && !opts.slackWebhook && !opts.out) {
      console.error('At least one of --slack-webhook or --out is required unless --dry-run is set');
      process.exit(1);
    }

    const ref = opts.week ? new Date(opts.week + 'T12:00:00Z') : new Date();
    const digests = await compileDigest(opts.local, ref);

    const totalRows = digests.reduce((sum, d) => sum + d.rows.length, 0);
    if (totalRows === 0) {
      console.log('No changes this week — skipping digest.');
      return;
    }

    const { start, end } = getWeekRange(ref);
    const [owner, repo] = opts.repo.split('/');
    const fmtOpts = { start, end, owner, repo };

    if (opts.dryRun) {
      console.log(formatMarkdownDigest(digests, fmtOpts));
      return;
    }

    if (opts.out) {
      await mkdir(dirname(opts.out), { recursive: true });
      await writeFile(opts.out, formatMarkdownDigest(digests, fmtOpts));
      console.log(`Wrote digest to ${opts.out}`);
    }

    if (opts.slackWebhook) {
      const res = await fetch(opts.slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: formatSlackDigest(digests, fmtOpts) }),
      });
      if (!res.ok) throw new Error(`Slack webhook returned ${res.status}: ${await res.text()}`);
      console.log('Weekly digest posted to Slack.');
    }
  });

program
  .command('confluence-update')
  .description('Publish snapshot history for every tracked document to Confluence')
  .requiredOption('--repo <owner/name>', 'GitHub snapshots repo slug (used to build absolute links)')
  .option('--local <path>', 'Local snapshots repo path', '.')
  .requiredOption('--confluence-url <url>', 'Confluence base URL, e.g. https://your-org.atlassian.net')
  .requiredOption('--confluence-email <email>', 'Atlassian account email')
  .requiredOption('--confluence-token <token>', 'Atlassian API token')
  .requiredOption('--confluence-space <key>', 'Confluence space key, e.g. NYLProject')
  .requiredOption('--confluence-parent <id>', 'Page ID of the parent page under which doc pages live')
  .action(
    async (opts: {
      repo: string;
      local: string;
      confluenceUrl: string;
      confluenceEmail: string;
      confluenceToken: string;
      confluenceSpace: string;
      confluenceParent: string;
    }) => {
      const auth = { email: opts.confluenceEmail, token: opts.confluenceToken };
      const [owner, repoName] = opts.repo.split('/');
      const snapshotsRoot = join(opts.local, 'snapshots');

      let docFolders: string[];
      try {
        docFolders = (await readdir(snapshotsRoot, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        console.error(`No snapshots directory found at ${snapshotsRoot}`);
        process.exit(1);
      }

      for (const folderName of docFolders) {
        const docDir = join(snapshotsRoot, folderName);

        let docTitle: string;
        try {
          const latest = JSON.parse(
            await readFile(join(docDir, 'latest.json'), 'utf8'),
          ) as LucidDocument;
          docTitle = latest.title;
        } catch {
          console.warn(`[${folderName}] No latest.json — skipping`);
          continue;
        }

        const ghBase = `https://github.com/${owner}/${repoName}/blob/main/snapshots/${folderName}`;

        let historyMd = '';
        try {
          const raw = await readFile(join(docDir, 'HISTORY.md'), 'utf8');
          // Strip top-level heading — we'll wrap it in a section heading ourselves
          const body = raw.replace(/^# [^\n]+\n\n/, '');
          historyMd = absolutifyLinks(body, ghBase);
        } catch {
          // No history yet — leave empty
        }

        let latestSummary = '';
        try {
          const entries = (await readdir(docDir, { withFileTypes: true }))
            .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
            .sort((a, b) => b.name.localeCompare(a.name));
          if (entries.length > 0) {
            const raw = await readFile(
              join(docDir, entries[0].name, 'summary.md'),
              'utf8',
            );
            // Strip page-renders section — relative image paths don't work in Confluence
            latestSummary = raw.replace(/\n\n---\n\n## Page renders[\s\S]*$/, '');
          }
        } catch {
          // No summary
        }

        const parts: string[] = [];
        if (latestSummary) parts.push(`## Latest Snapshot\n\n${latestSummary}`);
        if (historyMd) parts.push(`## Change History\n\n${historyMd}`);

        if (parts.length === 0) {
          console.log(`[${docTitle}] Nothing to publish — skipping`);
          continue;
        }

        const pageBody = markdownToStorage(parts.join('\n\n'));

        console.log(`[${docTitle}] Upserting Confluence page...`);
        await upsertPage(
          opts.confluenceSpace,
          opts.confluenceParent,
          docTitle,
          pageBody,
          opts.confluenceUrl,
          auth,
        );
        console.log(`[${docTitle}] Done.`);
      }
    },
  );

program.parseAsync();
