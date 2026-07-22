import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
export function getWeekRange(ref) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
    const daysFromMonday = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - daysFromMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
}
function parseFolderDate(ts) {
    return new Date(ts.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z'));
}
const UUID_SUFFIX_RE = /___[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function findDigestRanges(local, ref) {
    const docs = JSON.parse(await readFile(join(local, 'docs.json'), 'utf8'));
    const { start, end } = getWeekRange(ref);
    const allEntries = await readdir(local, { withFileTypes: true }).catch(() => []);
    const result = [];
    for (const doc of docs) {
        const docFolderName = allEntries.find(e => e.isDirectory() && UUID_SUFFIX_RE.test(e.name) && e.name.endsWith(`___${doc.id}`))?.name;
        if (!docFolderName) {
            result.push({ title: doc.title, docFolder: '', baselineTs: null, headTs: null });
            continue;
        }
        let snapDirs;
        try {
            snapDirs = (await readdir(join(local, docFolderName, 'snapshots'), { withFileTypes: true }))
                .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(e.name))
                .map(e => e.name)
                .sort(); // ascending chronological; later entries overwrite earlier ones below
        }
        catch {
            result.push({ title: doc.title, docFolder: docFolderName, baselineTs: null, headTs: null });
            continue;
        }
        let baselineTs = null;
        let headTs = null;
        for (const ts of snapDirs) {
            const d = parseFolderDate(ts);
            if (d < start)
                baselineTs = ts; // last-wins → most recent before week
            else if (d >= start && d <= end)
                headTs = ts; // last-wins → most recent in week
        }
        result.push({ title: doc.title, docFolder: docFolderName, baselineTs, headTs });
    }
    return result;
}
//# sourceMappingURL=digest.js.map