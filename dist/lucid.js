const LUCID_API_BASE = 'https://api.lucid.co';
function authHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        'Lucid-Api-Version': '1',
    };
}
export async function fetchDocument(documentId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    const res = await fetch(`${LUCID_API_BASE}/documents/${documentId}/contents`, {
        headers: authHeaders(apiKey),
    });
    if (!res.ok) {
        throw new Error(`Lucid API returned ${res.status} ${res.statusText}: ${await res.text()}`);
    }
    return (await res.json());
}
export async function exportPagePng(documentId, pageId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    // Endpoint path pending verification against Lucid REST docs; the export
    // endpoint differs by product/tier.
    const res = await fetch(`${LUCID_API_BASE}/documents/${documentId}?pageId=${encodeURIComponent(pageId)}`, {
        headers: { ...authHeaders(apiKey), Accept: 'image/png' },
    });
    if (!res.ok) {
        throw new Error(`Lucid PNG export returned ${res.status} ${res.statusText}: ${await res.text()}`);
    }
    return new Uint8Array(await res.arrayBuffer());
}
//# sourceMappingURL=lucid.js.map