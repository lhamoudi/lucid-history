import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
// Matches the current row format:
// | **YYYY-MM-DD HH:MM UTC**<br>[Summary](<folderTimestamp>/summary.md)...rest | added | changed | removed | pages | theme |
const ROW_RE = /^\|\s+\*\*(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\*\*<br>\[Summary\]\(([^)]+)\/summary\.md\)[^|]*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/;
export function parseHistoryRows(historyMd) {
    return historyMd
        .split('\n')
        .filter(l => l.startsWith('| **'))
        .flatMap(l => {
        const m = ROW_RE.exec(l);
        if (!m)
            return [];
        return [{
                timestamp: `${m[1]} ${m[2]} UTC`,
                isoDate: m[1],
                folderTimestamp: m[3],
                pagesAdded: parseInt(m[4], 10),
                pagesChanged: parseInt(m[5], 10),
                pagesRemoved: parseInt(m[6], 10),
                affectedPages: m[7].trim(),
                theme: m[8].trim(),
            }];
    });
}
export function getWeekRange(ref) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()));
    const daysFromMonday = (d.getUTCDay() + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
    const start = new Date(d);
    start.setUTCDate(d.getUTCDate() - daysFromMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
}
export async function compileDigest(local, ref) {
    const docs = JSON.parse(await readFile(join(local, 'docs.json'), 'utf8'));
    const snapshotsRoot = join(local, 'snapshots');
    const { start, end } = getWeekRange(ref);
    const result = [];
    for (const doc of docs) {
        const entries = await readdir(snapshotsRoot, { withFileTypes: true }).catch(() => []);
        const docFolderName = entries.find(e => e.isDirectory() && e.name.endsWith(`___${doc.id}`))?.name;
        if (!docFolderName) {
            result.push({ title: doc.title, docFolder: '', rows: [] });
            continue;
        }
        let historyMd;
        try {
            historyMd = await readFile(join(snapshotsRoot, docFolderName, 'HISTORY.md'), 'utf8');
        }
        catch {
            result.push({ title: doc.title, docFolder: docFolderName, rows: [] });
            continue;
        }
        const rows = parseHistoryRows(historyMd).filter(r => {
            const rowDate = new Date(r.isoDate + 'T00:00:00Z');
            return rowDate >= start && rowDate <= end;
        });
        result.push({ title: doc.title, docFolder: docFolderName, rows });
    }
    return result;
}
//# sourceMappingURL=digest.js.map