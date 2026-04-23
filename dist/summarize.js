import Anthropic from '@anthropic-ai/sdk';
const SYSTEM_PROMPT = `You are a technical writer summarizing changes to a Lucidchart diagram for a pull request body.

Write in clean markdown. Structure:
- If there are added/removed/renamed pages, list them with a one-line summary of each page's purpose inferred from its contents.
- For each page in perPage, write an H3 heading with the page title and a bullet list describing the material changes. Group related bullets (e.g. an added decision block plus two lines wiring it up should be one bullet about the new branch, not three).
- When referring to lines, use the text of the connected shapes (fromText/toText fields) rather than shape ids.
- Skip style/color noise. Focus on additions, removals, rewired connections, and text changes.
- Do not invent changes that aren't in the diff.
- End with a one-line "Theme:" describing what the overall change accomplishes, if one is apparent.`;
export async function summarizeDiff(docTitle, diff, opts = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        throw new Error('ANTHROPIC_API_KEY is not set');
    const client = new Anthropic({ apiKey });
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
                content: `Document: ${docTitle}\n\nDocDiff:\n\`\`\`json\n${JSON.stringify(diff, null, 2)}\n\`\`\``,
            },
        ],
    });
    return msg.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}
//# sourceMappingURL=summarize.js.map