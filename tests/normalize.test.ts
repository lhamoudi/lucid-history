import { describe, it, expect } from 'vitest';
import { normalize } from '../src/normalize.js';
import type { LucidDocument } from '../src/types.js';

describe('normalize', () => {
  it('sorts pages by index, shapes/lines by id, and is idempotent', () => {
    const doc: LucidDocument = {
      id: 'd',
      title: 'T',
      product: 'lucidchart',
      pages: [
        {
          id: 'p2',
          title: 'P2',
          index: 1,
          items: {
            shapes: [
              { id: 'b', class: 'Box' },
              { id: 'a', class: 'Box' },
            ],
            lines: [{ id: 'z', endpoint1: {}, endpoint2: {} }],
          },
        },
        {
          id: 'p1',
          title: 'P1',
          index: 0,
          items: {
            shapes: [],
            lines: [],
          },
        },
      ],
    };
    const once = normalize(doc);
    const twice = normalize(JSON.parse(once));
    expect(once).toBe(twice);

    const parsed = JSON.parse(once);
    expect(parsed.pages.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
    expect(parsed.pages[1].items.shapes.map((s: { id: string }) => s.id)).toEqual(['a', 'b']);
  });

  it('handles missing items arrays', () => {
    const doc = {
      id: 'd',
      title: 'T',
      product: 'lucidchart',
      pages: [{ id: 'p1', title: 'P1', index: 0, items: {} }],
    } as LucidDocument;
    const out = JSON.parse(normalize(doc));
    expect(out.pages[0].items.shapes).toEqual([]);
    expect(out.pages[0].items.lines).toEqual([]);
  });
});
