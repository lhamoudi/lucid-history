import { describe, it, expect } from 'vitest';
import { renderPageHistory, renderDocIndex, summarizeDiffForPage } from '../src/indexer.js';
import type { PageDiff } from '../src/types.js';

describe('renderPageHistory', () => {
  it('omits title history when title never changed', () => {
    const out = renderPageHistory('pid', 'Title', [{ from: null, to: null, title: 'Title' }], [
      { timestamp: '2026-04-22T10-30-00Z', renderFilename: '2026-04-22T10-30-00Z.png', summary: 'Added one block.' },
    ]);
    expect(out).not.toContain('## Title history');
    expect(out).toContain('### 2026-04-22T10-30-00Z · [render](2026-04-22T10-30-00Z.png)');
    expect(out).toContain('Added one block.');
  });

  it('includes title history when multiple titles seen', () => {
    const out = renderPageHistory(
      'pid',
      'NewTitle',
      [
        { from: null, to: '2026-04-22', title: 'OldTitle' },
        { from: '2026-04-22', to: null, title: 'NewTitle' },
      ],
      [],
    );
    expect(out).toContain('## Title history');
    expect(out).toContain('**OldTitle**');
    expect(out).toContain('**NewTitle**');
  });
});

describe('renderDocIndex', () => {
  it('renders a markdown table row per page', () => {
    const out = renderDocIndex('did', 'Doc', [
      { id: 'p1', currentTitle: 'Intro', firstSeen: '2026-04-22', lastChanged: '2026-04-22', renderCount: 1 },
    ]);
    expect(out).toContain('| `p1` | [Intro](p1/HISTORY.md) | 2026-04-22 | 2026-04-22 | 1 |');
  });
});

describe('summarizeDiffForPage', () => {
  it('joins non-zero categories', () => {
    const pd: PageDiff = {
      page: { id: 'p1', title: 'P1', renamedFrom: 'Old' },
      shapesAdded: [{ id: 's1', class: 'Box', text: 't' }],
      shapesRemoved: [],
      shapesTextChanged: [],
      shapesClassChanged: [],
      linesAdded: [],
      linesRemoved: [],
      linesRewired: [],
      linesLabelChanged: [],
    };
    expect(summarizeDiffForPage(pd)).toBe('Renamed from "Old". 1 shape(s) added.');
  });
});
