const LUCID_API_BASE = 'https://api.lucid.co';
async function withRetry(fn, maxAttempts = 4) {
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
            const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
            console.warn(`[lucid] Retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxAttempts})...`);
            await new Promise(r => setTimeout(r, delayMs));
        }
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const status = err.status;
            // Only retry on 5xx / network errors; propagate 4xx immediately
            if (typeof status === 'number' && status < 500)
                throw err;
        }
    }
    throw lastError;
}
function authHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        'Lucid-Api-Version': '1',
    };
}
function apiError(message, status) {
    return Object.assign(new Error(message), { status });
}
export async function createFolder(name, parentId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    return withRetry(async () => {
        const res = await fetch(`${LUCID_API_BASE}/folders`, {
            method: 'POST',
            headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, type: 'folder', parent: parentId }),
        });
        if (!res.ok)
            throw apiError(`Lucid folder creation failed ${res.status}: ${await res.text()}`, res.status);
        const data = (await res.json());
        return data.id;
    });
}
export async function copyDocument(sourceId, title, parentFolderId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    return withRetry(async () => {
        const res = await fetch(`${LUCID_API_BASE}/documents/copy`, {
            method: 'POST',
            headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, template: sourceId, parent: parentFolderId }),
        });
        if (!res.ok)
            throw apiError(`Lucid document copy failed ${res.status}: ${await res.text()}`, res.status);
        const data = (await res.json());
        return { id: data.id, url: data.editUrl ?? `https://lucid.app/lucidchart/${data.id}/edit` };
    });
}
export async function fetchDocument(documentId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    return withRetry(async () => {
        const res = await fetch(`${LUCID_API_BASE}/documents/${documentId}/contents`, {
            headers: authHeaders(apiKey),
        });
        if (!res.ok)
            throw apiError(`Lucid API returned ${res.status} ${res.statusText}: ${await res.text()}`, res.status);
        return (await res.json());
    });
}
export async function exportPagePng(documentId, pageId, apiKey = process.env.LUCID_API_KEY) {
    if (!apiKey)
        throw new Error('LUCID_API_KEY is not set');
    return withRetry(async () => {
        const res = await fetch(`${LUCID_API_BASE}/documents/${documentId}?pageId=${encodeURIComponent(pageId)}`, { headers: { ...authHeaders(apiKey), Accept: 'image/png' } });
        if (!res.ok)
            throw apiError(`Lucid PNG export returned ${res.status} ${res.statusText}: ${await res.text()}`, res.status);
        return new Uint8Array(await res.arrayBuffer());
    });
}
//# sourceMappingURL=lucid.js.map