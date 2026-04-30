import { writeFile, readdir, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { exportPagePng } from './lucid.js';
const sanitize = (s) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
// Matches "<any label> | <Month DD, YYYY>" — the date-stamp shape used across diagrams.
const LABEL_DATE_RE = /^[^|]+\|\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}$/;
function isDateOnlyChange(pd) {
    const isLabelDate = (text) => LABEL_DATE_RE.test(text.trim());
    return (pd.page.renamedFrom === null &&
        pd.shapesAdded.length === 0 &&
        pd.shapesRemoved.length === 0 &&
        pd.shapesClassChanged.length === 0 &&
        pd.linesAdded.length === 0 &&
        pd.linesRemoved.length === 0 &&
        pd.linesRewired.length === 0 &&
        pd.linesLabelChanged.length === 0 &&
        pd.shapesTextChanged.length > 0 &&
        pd.shapesTextChanged.every((c) => isLabelDate(c.before) && isLabelDate(c.after)));
}
export async function renderChangedPages(opts) {
    const result = [];
    for (const pageId of opts.changedPageIds) {
        const png = await exportPagePng(opts.documentId, pageId);
        const pageDir = join(opts.renderDir, pageId);
        await mkdir(pageDir, { recursive: true });
        const existingPngs = (await readdir(pageDir).catch(() => []))
            .filter((f) => f.endsWith('.png'))
            .sort();
        const beforePath = existingPngs.length > 0 ? join(pageDir, existingPngs[existingPngs.length - 1]) : null;
        // Skip the write if the page renders identically to the most recent stored
        // PNG. Closes the gap where the JSON diff says "changed" but the rendered
        // output is visually identical (e.g. trailing-whitespace-only text edits).
        const priorHash = beforePath ? sha256(await readFile(beforePath)) : null;
        const newHash = sha256(png);
        if (priorHash === newHash)
            continue;
        const title = opts.pageTitles.get(pageId) ?? pageId;
        const stem = `${opts.timestamp}-${sanitize(title)}`;
        const afterPath = join(pageDir, `${stem}.png`);
        await writeFile(afterPath, png);
        result.push({ pageTitle: title, before: beforePath, after: afterPath });
    }
    return result;
}
export async function renderComparedPages(opts) {
    const written = [];
    const pagesDir = join(opts.outDir, 'pages');
    await mkdir(pagesDir, { recursive: true });
    for (const pd of opts.diff.perPage) {
        if (isDateOnlyChange(pd))
            continue;
        const [before, after] = await Promise.all([
            exportPagePng(opts.baseDocumentId, pd.page.id),
            exportPagePng(opts.headDocumentId, pd.page.id),
        ]);
        if (sha256(before) === sha256(after))
            continue;
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
async function mostRecentHash(dir) {
    const files = await readdir(dir).catch(() => []);
    const pngs = files.filter((f) => f.endsWith('.png')).sort();
    if (pngs.length === 0)
        return null;
    const latest = await readFile(join(dir, pngs[pngs.length - 1]));
    return sha256(latest);
}
function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}
//# sourceMappingURL=renders.js.map