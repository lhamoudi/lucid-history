import { writeFile, readdir, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { exportPagePng } from './lucid.js';
import type { DocDiff, PageDiff } from './types.js';

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);

// Matches "<any label> | <Month DD, YYYY>" — the date-stamp shape used across diagrams.
const LABEL_DATE_RE =
  /^[^|]+\|\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}$/;

function isDateOnlyChange(pd: PageDiff): boolean {
  const isLabelDate = (text: string) => LABEL_DATE_RE.test(text.trim());
  return (
    pd.page.renamedFrom === null &&
    pd.shapesAdded.length === 0 &&
    pd.shapesRemoved.length === 0 &&
    pd.shapesClassChanged.length === 0 &&
    pd.linesAdded.length === 0 &&
    pd.linesRemoved.length === 0 &&
    pd.linesRewired.length === 0 &&
    pd.linesLabelChanged.length === 0 &&
    pd.shapesTextChanged.length > 0 &&
    pd.shapesTextChanged.every((c) => isLabelDate(c.before) && isLabelDate(c.after))
  );
}

export type PageRender = {
  pageTitle: string;
  before: string | null;  // absolute path to the previous PNG, null if first render
  after: string;          // absolute path to the newly written PNG
};

export async function renderChangedPages(opts: {
  documentId: string;
  changedPageIds: string[];
  pageTitles: Map<string, string>;
  timestamp: string;
  runDir: string;
  docDir: string;
}): Promise<PageRender[]> {
  const result: PageRender[] = [];
  for (const pageId of opts.changedPageIds) {
    const safePageTitle = sanitize(opts.pageTitles.get(pageId) ?? pageId);
    const safePageId = sanitize(pageId);
    const pageFileName = `${safePageTitle}___${safePageId}.png`;
    const afterPath = join(opts.runDir, pageFileName);

    // Search prior run dirs newest-first for a PNG matching this page's stable ID.
    // The title portion of the filename may differ if the page was renamed.
    const priorRunDirs = (await readdir(opts.docDir, { withFileTypes: true }).catch(() => []))
      .filter(d => d.isDirectory() && d.name < opts.timestamp)
      .map(d => d.name)
      .sort()
      .reverse();

    let beforePath: string | null = null;
    for (const runName of priorRunDirs) {
      const files = await readdir(join(opts.docDir, runName)).catch(() => [] as string[]);
      const match = files.find(f => f.endsWith(`___${safePageId}.png`));
      if (match) {
        beforePath = join(opts.docDir, runName, match);
        break;
      }
    }

    const png = await exportPagePng(opts.documentId, pageId);
    const priorHash = beforePath ? sha256(await readFile(beforePath)) : null;
    if (priorHash === sha256(png)) continue;

    const title = opts.pageTitles.get(pageId) ?? pageId;
    await mkdir(opts.runDir, { recursive: true });
    await writeFile(afterPath, png);
    result.push({ pageTitle: title, before: beforePath, after: afterPath });
  }
  return result;
}

export async function renderComparedPages(opts: {
  baseDocumentId: string;
  headDocumentId: string;
  diff: DocDiff;
  outDir: string;
}): Promise<string[]> {
  const written: string[] = [];
  const pagesDir = join(opts.outDir, 'pages');
  await mkdir(pagesDir, { recursive: true });

  for (const pd of opts.diff.perPage) {
    if (isDateOnlyChange(pd)) continue;
    const [before, after] = await Promise.all([
      exportPagePng(opts.baseDocumentId, pd.page.id),
      exportPagePng(opts.headDocumentId, pd.page.id),
    ]);
    if (sha256(before) === sha256(after)) continue;
    const baseTitle = sanitize(pd.page.renamedFrom ?? pd.page.title);
    const headTitle = sanitize(pd.page.title);
    const beforePath = join(pagesDir, `${baseTitle}-before.png`);
    const afterPath = join(pagesDir, `${headTitle}-after.png`);
    await writeFile(beforePath, before);
    await writeFile(afterPath, after);
    written.push(beforePath, afterPath);
  }

  return written;
}

function sha256(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
