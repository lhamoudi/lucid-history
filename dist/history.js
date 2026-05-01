import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const HEADER = '# Snapshot History\n\n' +
    '| Snapshot | +Pages | ~Pages | −Pages | Affected Pages | Summary | Lucid |\n' +
    '|:---------|-------:|-------:|-------:|:---------------|:--------|:------|\n';
function extractBlurb(summary) {
    const themeLine = summary
        .split('\n')
        .find(l => /^(?:\*\*)?Theme:(?:\*\*)?\s/i.test(l));
    if (themeLine) {
        return themeLine.replace(/^(?:\*\*)?Theme:(?:\*\*)?\s*/i, '').trim();
    }
    const firstPara = summary.split(/\n\n/)[0].replace(/\n/g, ' ').trim();
    return firstPara.length > 150 ? firstPara.slice(0, 147) + '…' : firstPara;
}
function formatTimestamp(ts) {
    const m = ts.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-\d{2}Z$/);
    return m ? `${m[1]} ${m[2]}:${m[3]} UTC` : ts;
}
function esc(s) {
    return s.replace(/\|/g, '\\|');
}
function buildRow(entry) {
    const allPages = [...entry.pagesAdded, ...entry.pagesChanged, ...entry.pagesRemoved];
    const pagesCell = allPages.length > 0 ? esc(allPages.join(' · ')) : '—';
    const link = `[${formatTimestamp(entry.timestamp)}](${entry.timestamp}/summary.md)`;
    const blurb = esc(extractBlurb(entry.summary));
    const lucidCell = entry.lucidUrl ? `[view](${entry.lucidUrl})` : '—';
    return `| ${link} | ${entry.pagesAdded.length} | ${entry.pagesChanged.length} | ${entry.pagesRemoved.length} | ${pagesCell} | ${blurb} | ${lucidCell} |`;
}
export async function appendHistoryEntry(docDir, entry) {
    const historyPath = join(docDir, 'HISTORY.md');
    const newRow = buildRow(entry);
    let existing;
    try {
        existing = await readFile(historyPath, 'utf8');
    }
    catch {
        existing = HEADER;
    }
    const lines = existing.split('\n');
    const sepIdx = lines.findIndex(l => l.startsWith('|:-'));
    if (sepIdx === -1) {
        await writeFile(historyPath, HEADER + newRow + '\n');
        return;
    }
    lines.splice(sepIdx + 1, 0, newRow);
    await writeFile(historyPath, lines.join('\n'));
}
//# sourceMappingURL=history.js.map