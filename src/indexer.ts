import type { PageDiff } from './types.js';

export type PageTitleRange = {
  from: string | null;
  to: string | null;
  title: string;
};

export type PageHistoryEntry = {
  timestamp: string;
  renderFilename: string | null;
  summary: string;
};

export function renderPageHistory(
  pageId: string,
  currentTitle: string,
  titleHistory: PageTitleRange[],
  entries: PageHistoryEntry[],
): string {
  const lines: string[] = [];
  lines.push(`# ${currentTitle}`);
  lines.push(`_Page id: \`${pageId}\`_`);
  lines.push('');
  if (titleHistory.length > 1) {
    lines.push('## Title history');
    for (const t of titleHistory) {
      const range =
        t.to === null
          ? `${t.from ?? '(initial)'} → present`
          : `${t.from ?? '(initial)'} → ${t.to}`;
      lines.push(`- ${range}: **${t.title}**`);
    }
    lines.push('');
  }
  lines.push('## Timeline (newest first)');
  lines.push('');
  for (const e of entries) {
    const header = e.renderFilename
      ? `### ${e.timestamp} · [render](${e.renderFilename})`
      : `### ${e.timestamp}`;
    lines.push(header);
    lines.push('');
    lines.push(e.summary.trim());
    lines.push('');
  }
  return lines.join('\n');
}

export type DocIndexEntry = {
  id: string;
  currentTitle: string;
  firstSeen: string;
  lastChanged: string;
  renderCount: number;
};

export function renderDocIndex(docId: string, docTitle: string, pages: DocIndexEntry[]): string {
  const lines: string[] = [];
  lines.push(`# ${docTitle}`);
  lines.push(`_Doc id: \`${docId}\`_`);
  lines.push('');
  lines.push('| Page id | Title | First seen | Last changed | Renders |');
  lines.push('|---|---|---|---|---|');
  for (const p of pages) {
    lines.push(
      `| \`${p.id}\` | [${p.currentTitle}](${p.id}/HISTORY.md) | ${p.firstSeen} | ${p.lastChanged} | ${p.renderCount} |`,
    );
  }
  return lines.join('\n') + '\n';
}

export function summarizeDiffForPage(pd: PageDiff): string {
  const parts: string[] = [];
  if (pd.page.renamedFrom) parts.push(`Renamed from "${pd.page.renamedFrom}".`);
  if (pd.shapesAdded.length) parts.push(`${pd.shapesAdded.length} shape(s) added.`);
  if (pd.shapesRemoved.length) parts.push(`${pd.shapesRemoved.length} shape(s) removed.`);
  if (pd.shapesTextChanged.length) parts.push(`${pd.shapesTextChanged.length} text change(s).`);
  if (pd.shapesClassChanged.length) parts.push(`${pd.shapesClassChanged.length} class change(s).`);
  if (pd.linesAdded.length) parts.push(`${pd.linesAdded.length} line(s) added.`);
  if (pd.linesRemoved.length) parts.push(`${pd.linesRemoved.length} line(s) removed.`);
  if (pd.linesRewired.length) parts.push(`${pd.linesRewired.length} line(s) rewired.`);
  if (pd.linesLabelChanged.length) parts.push(`${pd.linesLabelChanged.length} line label change(s).`);
  return parts.join(' ');
}
