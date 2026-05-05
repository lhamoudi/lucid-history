import type {
  LucidDocument,
  LucidShape,
  LucidLine,
  DocDiff,
  PageDiff,
  ShapeRef,
  LineRef,
} from './types.js';

function shapeText(shape: LucidShape): string {
  return (shape.textAreas ?? [])
    .filter((t) => t.label !== 'ReadonlyAttributionText')
    .map((t) => t.text ?? '')
    .join('\n');
}

function shapeRef(shape: LucidShape): ShapeRef {
  return { id: shape.id, class: shape.class, text: shapeText(shape) };
}

function lineRef(line: LucidLine): LineRef {
  return {
    id: line.id,
    from: line.endpoint1?.connectedTo ?? null,
    to: line.endpoint2?.connectedTo ?? null,
    style1: line.endpoint1?.style ?? null,
    style2: line.endpoint2?.style ?? null,
    label: (line.textAreas ?? []).map((t) => t.text ?? '').join(' | '),
  };
}

function byId<T extends { id: string }, R>(items: T[], map: (t: T) => R): Map<string, R> {
  return new Map(items.map((i) => [i.id, map(i)]));
}

function pageHasChanges(pd: PageDiff): boolean {
  return (
    pd.page.renamedFrom !== null ||
    pd.shapesAdded.length > 0 ||
    pd.shapesRemoved.length > 0 ||
    pd.shapesTextChanged.length > 0 ||
    pd.shapesClassChanged.length > 0 ||
    pd.linesAdded.length > 0 ||
    pd.linesRemoved.length > 0 ||
    pd.linesRewired.length > 0 ||
    pd.linesLabelChanged.length > 0
  );
}

export function diff(base: LucidDocument, head: LucidDocument): DocDiff {
  const baseById = new Map(base.pages.map((p) => [p.id, p]));
  const headById = new Map(head.pages.map((p) => [p.id, p]));

  const pagesAdded = head.pages
    .filter((p) => !baseById.has(p.id))
    .map((p) => ({ id: p.id, title: p.title, index: p.index }));
  const pagesRemoved = base.pages
    .filter((p) => !headById.has(p.id))
    .map((p) => ({ id: p.id, title: p.title, index: p.index }));

  const perPage: PageDiff[] = [];
  for (const hp of head.pages) {
    const bp = baseById.get(hp.id);
    if (!bp) continue;

    const bs = byId(bp.items.shapes ?? [], shapeRef);
    const hs = byId(hp.items.shapes ?? [], shapeRef);
    const bl = byId(bp.items.lines ?? [], lineRef);
    const hl = byId(hp.items.lines ?? [], lineRef);

    const pd: PageDiff = {
      page: {
        id: hp.id,
        title: hp.title,
        renamedFrom: bp.title !== hp.title ? bp.title : null,
      },
      shapesAdded: [...hs.entries()].filter(([id]) => !bs.has(id)).map(([, v]) => v),
      shapesRemoved: [...bs.entries()].filter(([id]) => !hs.has(id)).map(([, v]) => v),
      shapesTextChanged: [...hs.entries()]
        .filter(([id, v]) => {
          const b = bs.get(id);
          return b !== undefined && b.text !== v.text;
        })
        .map(([id, v]) => ({ id, class: v.class, before: bs.get(id)!.text, after: v.text })),
      shapesClassChanged: [...hs.entries()]
        .filter(([id, v]) => {
          const b = bs.get(id);
          return b !== undefined && b.class !== v.class;
        })
        .map(([id, v]) => ({ id, before: bs.get(id)!.class, after: v.class })),
      linesAdded: [...hl.entries()].filter(([id]) => !bl.has(id)).map(([, v]) => v),
      linesRemoved: [...bl.entries()].filter(([id]) => !hl.has(id)).map(([, v]) => v),
      linesRewired: [...hl.entries()]
        .filter(([id, v]) => {
          const b = bl.get(id);
          return b !== undefined && (b.from !== v.from || b.to !== v.to);
        })
        .map(([id, v]) => {
          const b = bl.get(id)!;
          return {
            id,
            before: { from: b.from, to: b.to, style1: b.style1, style2: b.style2 },
            after: { from: v.from, to: v.to, style1: v.style1, style2: v.style2 },
          };
        }),
      linesLabelChanged: [...hl.entries()]
        .filter(([id, v]) => {
          const b = bl.get(id);
          return b !== undefined && b.label !== v.label;
        })
        .map(([id, v]) => ({ id, before: bl.get(id)!.label, after: v.label })),
    };

    if (pageHasChanges(pd)) perPage.push(pd);
  }

  return { pagesAdded, pagesRemoved, perPage };
}

export function isEmpty(d: DocDiff): boolean {
  return d.pagesAdded.length === 0 && d.pagesRemoved.length === 0 && d.perPage.length === 0;
}

export function changedPageIds(d: DocDiff): string[] {
  return [...d.pagesAdded.map((p) => p.id), ...d.perPage.map((p) => p.page.id)];
}

export function enrichLinesWithShapeText(d: DocDiff, head: LucidDocument): DocDiff {
  const textById = new Map<string, string>();
  for (const page of head.pages) {
    for (const shape of page.items.shapes ?? []) {
      textById.set(shape.id, shapeText(shape));
    }
  }
  const lookup = (id: string | null) => (id ? textById.get(id) ?? null : null);
  const annotate = <T extends { from: string | null; to: string | null }>(l: T) => ({
    ...l,
    fromText: lookup(l.from),
    toText: lookup(l.to),
  });

  return {
    ...d,
    perPage: d.perPage.map((pd) => ({
      ...pd,
      linesAdded: pd.linesAdded.map(annotate) as LineRef[],
      linesRemoved: pd.linesRemoved.map(annotate) as LineRef[],
      linesRewired: pd.linesRewired.map((r) => ({
        ...r,
        before: annotate(r.before),
        after: annotate(r.after),
      })) as PageDiff['linesRewired'],
    })),
  };
}
