import { describe, it, expect } from 'vitest';
import { diff, isEmpty, changedPageIds } from '../src/diff.js';
import type { LucidDocument, LucidPage, LucidShape, LucidLine } from '../src/types.js';

function doc(pages: LucidPage[]): LucidDocument {
  return { id: 'd', title: 'T', product: 'lucidchart', pages };
}

function shape(id: string, cls: string, text = ''): LucidShape {
  return { id, class: cls, textAreas: [{ label: 'Text', text }] };
}

function line(id: string, from: string, to: string, label = ''): LucidLine {
  return {
    id,
    endpoint1: { style: 'None', connectedTo: from },
    endpoint2: { style: 'Arrow', connectedTo: to },
    textAreas: label ? [{ label: 't0', text: label }] : undefined,
  };
}

function page(
  id: string,
  title: string,
  index: number,
  shapes: LucidShape[] = [],
  lines: LucidLine[] = [],
): LucidPage {
  return { id, title, index, items: { shapes, lines } };
}

describe('diff', () => {
  it('is empty for identical docs', () => {
    const d = doc([page('p1', 'P1', 0, [shape('s1', 'Box', 'hi')])]);
    expect(isEmpty(diff(d, d))).toBe(true);
  });

  it('detects added page', () => {
    const base = doc([page('p1', 'P1', 0)]);
    const head = doc([page('p1', 'P1', 0), page('p2', 'P2', 1)]);
    const r = diff(base, head);
    expect(r.pagesAdded.map((p) => p.id)).toEqual(['p2']);
    expect(r.pagesRemoved).toEqual([]);
  });

  it('detects removed page', () => {
    const base = doc([page('p1', 'P1', 0), page('p2', 'P2', 1)]);
    const head = doc([page('p1', 'P1', 0)]);
    const r = diff(base, head);
    expect(r.pagesRemoved.map((p) => p.id)).toEqual(['p2']);
  });

  it('detects page rename', () => {
    const base = doc([page('p1', 'Old', 0)]);
    const head = doc([page('p1', 'New', 0)]);
    const r = diff(base, head);
    expect(r.perPage).toHaveLength(1);
    expect(r.perPage[0].page.renamedFrom).toBe('Old');
  });

  it('detects shape add/remove/text/class changes', () => {
    const base = doc([page('p1', 'P1', 0, [shape('s1', 'Box', 'old'), shape('s2', 'Box')])]);
    const head = doc([
      page('p1', 'P1', 0, [shape('s1', 'Circle', 'new'), shape('s3', 'Box', 'added')]),
    ]);
    const r = diff(base, head);
    const pd = r.perPage[0];
    expect(pd.shapesAdded.map((s) => s.id)).toEqual(['s3']);
    expect(pd.shapesRemoved.map((s) => s.id)).toEqual(['s2']);
    expect(pd.shapesTextChanged).toEqual([
      { id: 's1', class: 'Circle', before: 'old', after: 'new' },
    ]);
    expect(pd.shapesClassChanged).toEqual([{ id: 's1', before: 'Box', after: 'Circle' }]);
  });

  it('detects line add/remove/rewire/label-change', () => {
    const base = doc([
      page(
        'p1',
        'P1',
        0,
        [],
        [line('l1', 'a', 'b'), line('l2', 'c', 'd', 'old'), line('l3', 'e', 'f')],
      ),
    ]);
    const head = doc([
      page(
        'p1',
        'P1',
        0,
        [],
        [line('l1', 'a', 'z'), line('l2', 'c', 'd', 'new'), line('l4', 'g', 'h')],
      ),
    ]);
    const r = diff(base, head);
    const pd = r.perPage[0];
    expect(pd.linesAdded.map((l) => l.id)).toEqual(['l4']);
    expect(pd.linesRemoved.map((l) => l.id)).toEqual(['l3']);
    expect(pd.linesRewired[0]).toMatchObject({
      id: 'l1',
      before: { to: 'b' },
      after: { to: 'z' },
    });
    expect(pd.linesLabelChanged).toEqual([{ id: 'l2', before: 'old', after: 'new' }]);
  });

  it('omits unchanged pages from perPage', () => {
    const base = doc([
      page('p1', 'P1', 0, [shape('s1', 'Box', 'same')]),
      page('p2', 'P2', 1, [shape('s2', 'Box', 'same')]),
    ]);
    const head = doc([
      page('p1', 'P1', 0, [shape('s1', 'Box', 'same')]),
      page('p2', 'P2', 1, [shape('s2', 'Box', 'changed')]),
    ]);
    const r = diff(base, head);
    expect(r.perPage).toHaveLength(1);
    expect(r.perPage[0].page.id).toBe('p2');
  });

  it('changedPageIds includes both added and modified pages', () => {
    const base = doc([page('p1', 'P1', 0, [shape('s1', 'Box', 'a')])]);
    const head = doc([
      page('p1', 'P1', 0, [shape('s1', 'Box', 'b')]),
      page('p2', 'P2', 1),
    ]);
    const ids = changedPageIds(diff(base, head));
    expect(new Set(ids)).toEqual(new Set(['p1', 'p2']));
  });
});
