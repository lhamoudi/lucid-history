const LUCID_API_BASE = 'https://api.lucid.co';
function authHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        'Lucid-Api-Version': '1',
    };
}
export async function createFolder(name, parentId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    const res = await fetch(`${LUCID_API_BASE}/folders`, {
        method: 'POST',
        headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type: 'folder', parent: parentId }),
    });
    if (!res.ok)
        throw new Error(`Lucid folder creation failed ${res.status}: ${await res.text()}`);
    const data = (await res.json());
    return data.id;
}
export async function copyDocument(sourceId, title, parentFolderId, product, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    const res = await fetch(`${LUCID_API_BASE}/documents`, {
        method: 'POST',
        headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, product, parent: parentFolderId, template: sourceId }),
    });
    if (!res.ok)
        throw new Error(`Lucid document copy failed ${res.status}: ${await res.text()}`);
    const data = (await res.json());
    return { id: data.id, url: data.editUrl ?? `https://lucid.app/lucidchart/${data.id}/edit` };
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