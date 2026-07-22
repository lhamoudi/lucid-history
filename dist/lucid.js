const LUCID_API_BASE = 'https://api.lucid.co';
// 408/429 are retryable 4xx; all 5xx are retried implicitly.
const RETRYABLE_4XX = new Set([408, 429]);
async function withRetry(fn, maxAttempts = 7) {
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err;
            const status = err.status;
            const msg = err.message ?? String(err);
            if (typeof status === 'number') {
                const retryable = RETRYABLE_4XX.has(status) || status >= 500;
                if (!retryable)
                    throw err;
            }
            if (attempt + 1 < maxAttempts) {
                const delayMs = 1000 * 2 ** attempt;
                console.warn(`[lucid] ${status ? `HTTP ${status}` : 'Error'} — retrying in ${delayMs / 1000}s (attempt ${attempt + 2}/${maxAttempts}): ${msg}`);
                await new Promise(r => setTimeout(r, delayMs));
            }
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
    let hint = '';
    if (status === 403)
        hint = ' — LUCID_API_KEY may be expired or lack access to this document; check Account Settings → Developer → API tokens in Lucid';
    if (status === 401)
        hint = ' — LUCID_API_KEY is invalid or has been revoked; regenerate it in Lucid Account Settings → Developer';
    return Object.assign(new Error(message + hint), { status });
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
        const url = data.editUrl ?? (data.id || data.documentId ? `https://lucid.app/lucidchart/${data.id ?? data.documentId}/edit` : undefined);
        const id = data.id ?? data.documentId ?? url?.match(/\/lucidchart\/([0-9a-f-]{36})\//)?.[1];
        if (!id)
            throw new Error(`copyDocument: could not determine document ID from response: ${JSON.stringify(data)}`);
        return { id, url: url ?? `https://lucid.app/lucidchart/${id}/edit` };
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