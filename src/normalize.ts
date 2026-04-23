import type { LucidDocument } from './types.js';

export function normalize(doc: LucidDocument): string {
  const sorted = {
    ...doc,
    pages: [...doc.pages]
      .sort((a, b) => a.index - b.index)
      .map((p) => ({
        ...p,
        items: {
          shapes: (p.items.shapes ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)),
          lines: (p.items.lines ?? []).slice().sort((a, b) => a.id.localeCompare(b.id)),
        },
      })),
  };
  return JSON.stringify(sorted, null, 2) + '\n';
}
