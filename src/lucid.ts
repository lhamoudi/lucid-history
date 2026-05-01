import type { LucidDocument } from './types.js';

const LUCID_API_BASE = 'https://api.lucid.co';

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Lucid-Api-Version': '1',
  };
}

export async function createFolder(
  name: string,
  parentId: number,
  apiKey = process.env.LUCID_API_KEY,
): Promise<number> {
  if (!apiKey) throw new Error('LUCID_API_KEY is not set');
  const res = await fetch(`${LUCID_API_BASE}/folders`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type: 'folder', parent: parentId }),
  });
  if (!res.ok) throw new Error(`Lucid folder creation failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: number };
  return data.id;
}

export async function copyDocument(
  sourceId: string,
  title: string,
  parentFolderId: number,
  apiKey = process.env.LUCID_API_KEY,
): Promise<{ id: string; url: string }> {
  if (!apiKey) throw new Error('LUCID_API_KEY is not set');
  const res = await fetch(`${LUCID_API_BASE}/documents/copy`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, template: sourceId, parent: parentFolderId }),
  });
  if (!res.ok) throw new Error(`Lucid document copy failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string; editUrl?: string };
  return { id: data.id, url: data.editUrl ?? `https://lucid.app/lucidchart/${data.id}/edit` };
}

export async function fetchDocument(
  documentId: string,
  apiKey = process.env.LUCID_API_KEY,
): Promise<LucidDocument> {
  if (!apiKey) throw new Error('LUCID_API_KEY is not set');
  const res = await fetch(`${LUCID_API_BASE}/documents/${documentId}/contents`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error(
      `Lucid API returned ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  return (await res.json()) as LucidDocument;
}

export async function exportPagePng(
  documentId: string,
  pageId: string,
  apiKey = process.env.LUCID_API_KEY,
): Promise<Uint8Array> {
  if (!apiKey) throw new Error('LUCID_API_KEY is not set');
  const res = await fetch(
    `${LUCID_API_BASE}/documents/${documentId}?pageId=${encodeURIComponent(pageId)}`,
    {
      headers: { ...authHeaders(apiKey), Accept: 'image/png' },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Lucid PNG export returned ${res.status} ${res.statusText}: ${await res.text()}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
