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
  renderDir: string;
}): Promise<PageRender[]> {
  const result: PageRender[] = [];
  for (const pageId of opts.changedPageIds) {
    const png = await exportPagePng(opts.documentId, pageId);
    const pageDir = join(opts.renderDir, pageId);
    await mkdir(pageDir, { recursive: true });

    const existingPngs = (await readdir(pageDir).catch(() => [] as string[]))
      .filter((f) => f.endsWith('.png'))
      .sort();
    const beforePath = existingPngs.length > 0 ? join(pageDir, existingPngs[existingPngs.length - 1]) : null;

    // Skip the write if the page renders identically to the most recent stored
    // PNG. Closes the gap where the JSON diff says "changed" but the rendered
    // output is visually identical (e.g. trailing-whitespace-only text edits).
    const priorHash = beforePath ? sha256(await readFile(beforePath)) : null;
    const newHash = sha256(png);
    if (priorHash === newHash) continue;

    const title = opts.pageTitles.get(pageId) ?? pageId;
    const stem = `${opts.timestamp}-${sanitize(title)}`;
    const afterPath = join(pageDir, `${stem}.png`);
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

async function mostRecentHash(dir: string): Promise<string | null> {
  const files = await readdir(dir).catch(() => [] as string[]);
  const pngs = files.filter((f) => f.endsWith('.png')).sort();
  if (pngs.length === 0) return null;
  const latest = await readFile(join(dir, pngs[pngs.length - 1]));
  return sha256(latest);
}

function sha256(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
