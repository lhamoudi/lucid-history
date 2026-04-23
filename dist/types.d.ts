export type LucidTextArea = {
    label?: string;
    text?: string;
};
export type LucidShape = {
    id: string;
    class: string;
    textAreas?: LucidTextArea[];
    style?: unknown;
    customData?: unknown;
};
export type LucidEndpoint = {
    style?: string;
    connectedTo?: string;
};
export type LucidLine = {
    id: string;
    endpoint1: LucidEndpoint;
    endpoint2: LucidEndpoint;
    textAreas?: LucidTextArea[];
};
export type LucidPage = {
    id: string;
    title: string;
    index: number;
    items: {
        shapes?: LucidShape[];
        lines?: LucidLine[];
    };
};
export type LucidDocument = {
    id: string;
    title: string;
    product: string;
    pages: LucidPage[];
};
export type ShapeRef = {
    id: string;
    class: string;
    text: string;
};
export type LineEndpoints = {
    from: string | null;
    to: string | null;
    style1: string | null;
    style2: string | null;
};
export type LineRef = LineEndpoints & {
    id: string;
    label: string;
};
export type PageRef = {
    id: string;
    title: string;
    index: number;
};
export type PageDiff = {
    page: {
        id: string;
        title: string;
        renamedFrom: string | null;
    };
    shapesAdded: ShapeRef[];
    shapesRemoved: ShapeRef[];
    shapesTextChanged: Array<{
        id: string;
        class: string;
        before: string;
        after: string;
    }>;
    shapesClassChanged: Array<{
        id: string;
        before: string;
        after: string;
    }>;
    linesAdded: LineRef[];
    linesRemoved: LineRef[];
    linesRewired: Array<{
        id: string;
        before: LineEndpoints;
        after: LineEndpoints;
    }>;
    linesLabelChanged: Array<{
        id: string;
        before: string;
        after: string;
    }>;
};
export type DocDiff = {
    pagesAdded: PageRef[];
    pagesRemoved: PageRef[];
    perPage: PageDiff[];
};
