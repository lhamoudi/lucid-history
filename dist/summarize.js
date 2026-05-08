import Anthropic from '@anthropic-ai/sdk';
const SYSTEM_PROMPT = `You are a technical writer summarizing changes to a Lucidchart diagram for a pull request body.

Write in clean markdown. Structure:
- **Pages Renamed** (if any): pages where \`renamedFrom\` is non-null in the \`pagesRenamed\` array. List as "Old Name → New Name". If the page also has content changes in \`perPage\`, note that briefly.
- **Pages Added** (if any): entries in \`pagesAdded\`. Give a one-line description of each page's purpose inferred from any content changes visible in \`perPage\`, or from its title if no content data is present.
- **Pages Removed** (if any): entries in \`pagesRemoved\`.
- For each page in \`perPage\` that is NOT a rename-only change, write an H3 heading with the page title and a bullet list describing the material changes. Group related bullets (e.g. an added decision block plus two lines wiring it up should be one bullet about the new branch, not three).
- When referring to lines, use the text of the connected shapes (fromText/toText fields) rather than shape ids.
- Skip style/color noise. Focus on additions, removals, rewired connections, and text changes.
- Skip diagram date stamp changes (e.g. "Updated date stamp from X to Y") — these are maintenance noise, not meaningful content changes.
- Do not invent changes that aren't in the diff.
- End with a one-line "Theme:" describing what the overall change accomplishes, if one is apparent.`;
export async function summarizeDiff(docTitle, diff, opts = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey });
    const renamedIds = new Set(diff.perPage.filter((pd) => pd.page.renamedFrom !== null).map((pd) => pd.page.id));
    const pagesRenamed = diff.perPage
        .filter((pd) => pd.page.renamedFrom !== null)
        .map((pd) => ({ id: pd.page.id, from: pd.page.renamedFrom, to: pd.page.title }));
    const payload = {
        pagesRenamed,
        pagesAdded: diff.pagesAdded,
        pagesRemoved: diff.pagesRemoved,
        perPage: diff.perPage,
        _note: renamedIds.size > 0
            ? `Pages with ids [${[...renamedIds].join(', ')}] in perPage are renames — their old names appear in pagesRenamed, not as removed pages.`
            : undefined,
    };
    const msg = await client.messages.create({
        model: opts.model ?? 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: [
            {
                type: 'text',
                text: SYSTEM_PROMPT,
                cache_control: { type: 'ephemeral' },
            },
        ],
        messages: [
            {
                role: 'user',
                content: `Document: ${docTitle}\n\nDocDiff:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``,
            },
        ],
    });
    return msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}
//# sourceMappingURL=summarize.js.map