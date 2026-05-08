type Auth = { email: string; token: string };
type PageMeta = { id: string; version: number };

function siteOrigin(url: string): string {
  try { return new URL(url).origin; } catch { return url.replace(/\/+$/, ''); }
}

function authHeader(auth: Auth): string {
  return `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}`;
}

async function apiRequest(
  method: string,
  url: string,
  auth: Auth,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(auth),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Confluence ${method} ${url} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function findPage(
  spaceKey: string,
  title: string,
  baseUrl: string,
  auth: Auth,
): Promise<PageMeta | null> {
  const url =
    `${siteOrigin(baseUrl)}/wiki/rest/api/content` +
    `?spaceKey=${encodeURIComponent(spaceKey)}` +
    `&title=${encodeURIComponent(title)}` +
    `&expand=version`;
  const data = (await apiRequest('GET', url, auth)) as {
    results: Array<{ id: string; version: { number: number } }>;
  };
  if (data.results.length === 0) return null;
  const page = data.results[0];
  return { id: page.id, version: page.version.number };
}

export async function createPage(
  spaceKey: string,
  parentId: string,
  title: string,
  body: string,
  baseUrl: string,
  auth: Auth,
): Promise<string> {
  const data = (await apiRequest('POST', `${siteOrigin(baseUrl)}/wiki/rest/api/content`, auth, {
    type: 'page',
    title,
    space: { key: spaceKey },
    ancestors: [{ id: parentId }],
    body: { storage: { value: body, representation: 'storage' } },
  })) as { id: string };
  return data.id;
}

export async function updatePage(
  pageId: string,
  title: string,
  body: string,
  version: number,
  baseUrl: string,
  auth: Auth,
): Promise<void> {
  await apiRequest('PUT', `${siteOrigin(baseUrl)}/wiki/rest/api/content/${pageId}`, auth, {
    type: 'page',
    title,
    version: { number: version + 1 },
    body: { storage: { value: body, representation: 'storage' } },
  });
}

export async function upsertPage(
  spaceKey: string,
  parentId: string,
  title: string,
  body: string,
  baseUrl: string,
  auth: Auth,
): Promise<string> {
  const existing = await findPage(spaceKey, title, baseUrl, auth);
  if (existing) {
    await updatePage(existing.id, title, body, existing.version, baseUrl, auth);
    return existing.id;
  } else {
    return await createPage(spaceKey, parentId, title, body, baseUrl, auth);
  }
}

export type SnapshotImage = { filename: string; data: Buffer };

export async function uploadAttachment(
  pageId: string,
  filename: string,
  data: Buffer,
  baseUrl: string,
  auth: Auth,
): Promise<void> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), filename);
  const res = await fetch(
    `${siteOrigin(baseUrl)}/wiki/rest/api/content/${pageId}/child/attachment`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader(auth),
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Confluence attachment upload ${filename} → ${res.status}: ${text}`);
  }
}

export async function createSnapshotPage(
  spaceKey: string,
  docPageId: string,
  title: string,
  summaryMd: string,
  images: SnapshotImage[],
  baseUrl: string,
  auth: Auth,
): Promise<string> {
  const existing = await findPage(spaceKey, title, baseUrl, auth);
  if (existing) {
    return `${siteOrigin(baseUrl)}/wiki/spaces/${spaceKey}/pages/${existing.id}`;
  }

  const stripped = summaryMd
    .replace(/\n\n---\n\n## Page renders[\s\S]*$/, '')
    .replace(/\n\n---\n\n\*\*Lucid snapshot:.*$/s, '');
  let body = markdownToStorage(stripped);

  const pageId = await createPage(spaceKey, docPageId, title, body, baseUrl, auth);

  const uploadedFilenames: string[] = [];
  for (const img of images) {
    try {
      await uploadAttachment(pageId, img.filename, img.data, baseUrl, auth);
      uploadedFilenames.push(img.filename);
    } catch {
      // Skip failed uploads — page still created, just missing that image
    }
  }

  if (uploadedFilenames.length > 0) {
    const imgSection =
      '<h2>Page Renders</h2>' +
      uploadedFilenames
        .map((f) => `<ac:image ac:width="800"><ri:attachment ri:filename="${escapeAttr(f)}"/></ac:image>`)
        .join('');
    body += imgSection;
    await updatePage(pageId, title, body, 1, baseUrl, auth);
  }

  return `${siteOrigin(baseUrl)}/wiki/spaces/${spaceKey}/pages/${pageId}`;
}

// ---------------------------------------------------------------------------
// Markdown → Confluence storage format (XHTML-like)
// ---------------------------------------------------------------------------

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function inline(raw: string): string {
  const tokens: string[] = [];

  let s = raw
    .replace(/<br\s*\/?>/gi, '\x01BR\x01')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // strip images

  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const idx = tokens.length;
    tokens.push(`<a href="${escapeAttr(url)}">${escapeText(text)}</a>`);
    return `\x01T${idx}\x01`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, (_, text) => {
    const idx = tokens.length;
    tokens.push(`<strong>${escapeText(text)}</strong>`);
    return `\x01T${idx}\x01`;
  });

  s = s.replace(/`([^`]+)`/g, (_, text) => {
    const idx = tokens.length;
    tokens.push(`<code>${escapeText(text)}</code>`);
    return `\x01T${idx}\x01`;
  });

  s = escapeText(s);
  s = s.replace(/\x01BR\x01/g, '<br/>');
  s = s.replace(/\x01T(\d+)\x01/g, (_, i) => tokens[parseInt(i, 10)]);
  return s;
}

export function markdownToStorage(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let tablePhase: 'none' | 'header' | 'body' = 'none';
  let listDepth = 0;
  let pendingPara: string[] = [];

  function flushPara() {
    if (pendingPara.length > 0) {
      out.push(`<p>${pendingPara.join('<br/>')}</p>`);
      pendingPara = [];
    }
  }
  function closeList() {
    while (listDepth > 0) { out.push('</ul>'); listDepth--; }
  }
  function closeTable() {
    if (tablePhase !== 'none') { out.push('</tbody></table>'); tablePhase = 'none'; }
  }
  function closeBlock() { flushPara(); closeList(); closeTable(); }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      closeBlock();
      out.push(`<h${headingMatch[1].length}>${inline(headingMatch[2])}</h${headingMatch[1].length}>`);
      continue;
    }

    if (/^-{3,}$/.test(line.trim()) && !line.startsWith('|')) {
      closeBlock();
      out.push('<hr/>');
      continue;
    }

    if (line.startsWith('|')) {
      flushPara(); closeList();
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        tablePhase = 'body';
        continue;
      }
      if (tablePhase === 'none') {
        out.push('<table><tbody>');
        tablePhase = 'header';
      }
      const tag = tablePhase === 'header' ? 'th' : 'td';
      out.push(`<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`);
      if (tablePhase === 'header') tablePhase = 'body';
      continue;
    }

    const bulletMatch = line.match(/^( *)[-*] (.*)/);
    if (bulletMatch) {
      flushPara(); closeTable();
      const depth = bulletMatch[1].length >= 2 ? 2 : 1;
      while (listDepth < depth) { out.push('<ul>'); listDepth++; }
      while (listDepth > depth) { out.push('</ul>'); listDepth--; }
      out.push(`<li>${inline(bulletMatch[2])}</li>`);
      continue;
    }

    if (line.trim() === '') {
      closeBlock();
      continue;
    }

    closeTable(); closeList();
    pendingPara.push(inline(line));
  }

  closeBlock();
  return out.join('');
}

export function absolutifyLinks(md: string, baseGithubUrl: string): string {
  return md.replace(
    /\[([^\]]+)\]\((?!https?:\/\/)([^)]+)\)/g,
    (_, text, path) => `[${text}](${baseGithubUrl}/${path})`,
  );
}
