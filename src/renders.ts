import { writeFile, readdir, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { exportPagePng } from './lucid.js';

export async function renderChangedPages(opts: {
  documentId: string;
  changedPageIds: string[];
  timestamp: string;
  renderDir: string;
}): Promise<string[]> {
  const written: string[] = [];
  for (const pageId of opts.changedPageIds) {
    const png = await exportPagePng(opts.documentId, pageId);
    const pageDir = join(opts.renderDir, pageId);
    await mkdir(pageDir, { recursive: true });

    // Skip the write if the page renders identically to the most recent stored
    // PNG. Closes the gap where the JSON diff says "changed" but the rendered
    // output is visually identical (e.g. trailing-whitespace-only text edits).
    const priorHash = await mostRecentHash(pageDir);
    const newHash = sha256(png);
    if (priorHash === newHash) continue;

    const path = join(pageDir, `${opts.timestamp}.png`);
    await writeFile(path, png);
    written.push(path);
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
