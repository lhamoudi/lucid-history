import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type SnapshotRange = {
  title: string;
  docFolder: string;
  /** Most recent snapshot taken strictly before the week window. Null if none exists. */
  baselineTs: string | null;
  /** Most recent snapshot taken within the week window. Null if no activity this week. */
  headTs: string | null;
};

export function getWeekRange(ref: Date): { start: Date; end: Date } {
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
  const daysFromMonday = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - daysFromMonday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function parseFolderDate(ts: string): Date {
  return new Date(ts.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z'));
}

const UUID_SUFFIX_RE = /___[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findDigestRanges(local: string, ref: Date): Promise<SnapshotRange[]> {
  type DocEntry = { id: string; title: string };
  const docs = JSON.parse(await readFile(join(local, 'docs.json'), 'utf8')) as DocEntry[];
  const { start, end } = getWeekRange(ref);
  const allEntries = await readdir(local, { withFileTypes: true }).catch(() => []);

  const result: SnapshotRange[] = [];
  for (const doc of docs) {
    const docFolderName = allEntries.find(
      e => e.isDirectory() && UUID_SUFFIX_RE.test(e.name) && e.name.endsWith(`___${doc.id}`),
    )?.name;

    if (!docFolderName) {
      result.push({ title: doc.title, docFolder: '', baselineTs: null, headTs: null });
      continue;
    }

    let snapDirs: string[];
    try {
      snapDirs = (await readdir(join(local, docFolderName, 'snapshots'), { withFileTypes: true }))
        .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
        .map(e => e.name)
        .sort(); // ascending chronological; later entries overwrite earlier ones below
    } catch {
      result.push({ title: doc.title, docFolder: docFolderName, baselineTs: null, headTs: null });
      continue;
    }

    let baselineTs: string | null = null;
    let headTs: string | null = null;

    for (const ts of snapDirs) {
      const d = parseFolderDate(ts);
      if (d < start) baselineTs = ts;        // last-wins → most recent before week
      else if (d >= start && d <= end) headTs = ts; // last-wins → most recent in week
    }

    result.push({ title: doc.title, docFolder: docFolderName, baselineTs, headTs });
  }

  return result;
}
