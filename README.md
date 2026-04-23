# lucid-history

Track Lucidchart changes over time. Each day, take a structural JSON snapshot of one or more Lucidchart documents, commit it to a private GitHub repo, and open a PR whose body is an AI-generated summary of what changed since the last snapshot. A per-page history of rendered PNGs is maintained alongside, so reviewers can see each tab's visual evolution.

## How it works

```
Lucid REST API  →  fetch document JSON  →  normalize  →  semantic diff vs latest
                                                              ↓
                                                         non-empty?
                                                              ↓
           render PNGs for changed pages  ←  yes  ←  +  Anthropic summary
                                                              ↓
                                    commit {JSON, PNGs, daily summary}
                                                              ↓
                                               open PR on snapshots repo
```

The semantic diff keys shapes and lines by their stable Lucid IDs and reports: added/removed/renamed pages, added/removed/text-changed/class-changed shapes, and added/removed/rewired/label-changed lines. Layout coordinates are not in the source data at all, so pure "drag this block" edits produce no diff.

## Prerequisites

- Node.js 20+ (tested on 22)
- Lucid API key — requires a Lucid plan that exposes the REST API (Team/Enterprise)
- Anthropic API key
- GitHub personal access token with `repo` scope for the private snapshots repo

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

## Install

```bash
git clone https://github.com/your-org/lucid-history.git
cd lucid-history
npm install
npm run build
```

## Commands

### `fetch` — pull a document and write its JSON

```bash
npx lucid-history fetch <doc-id> --out /tmp/doc.json
```

### `diff` — compare two committed snapshots

```bash
npx lucid-history diff path/to/base.json path/to/head.json
npx lucid-history diff path/to/base.json path/to/head.json --raw   # DocDiff JSON only, no AI
```

### `compare` — diff two live Lucid documents

```bash
npx lucid-history compare <base-doc-id> <head-doc-id>
npx lucid-history compare <base-doc-id> <head-doc-id> --raw   # DocDiff JSON only, no AI
```

Fetches both documents live and prints an AI-generated summary of structural differences. Useful when you restore an old version of a document in Lucid (which creates a new doc ID) and want to compare it against the current version.

### `snapshot` — full daily pipeline

```bash
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo --dry-run
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo --skip-renders
```

`--skip-renders` bypasses PNG export — useful while the Lucid PNG endpoint is being validated.

No prior snapshot? The first run creates an "initial snapshot" commit with no summary.
No material changes since last snapshot? No commit, no PR — the command exits silently.

## Snapshots repo layout

The tool writes to the snapshots repo with this structure:

```
snapshots/
  <doc-id>/
    json/
      2026-04-22T10-30-00Z.json        written daily
      latest.json                       copy of most recent
    pages/
      <page-id>/
        2026-04-22T10-30-00Z.png        only when this page changed
        HISTORY.md                       per-page timeline (v0.2)
    daily/
      2026-04-22.md                     the PR body, archived
```

A companion file per doc (`snapshots/<doc-id>/_index.md`) lists every page id seen, its current title, and its history. Page titles can change; page ids are stable — so the indexer is the translation layer between opaque ids and human-readable titles.

## GitHub Actions

A ready-to-use workflow lives at `.github/workflows/daily-snapshot.yml`. Add these secrets to your repo and fill in your doc ID and snapshots repo name in the workflow file:

| Secret | Description |
|---|---|
| `LUCID_API_KEY` | Lucid REST API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `SNAPSHOTS_GITHUB_TOKEN` | GitHub PAT with `repo` scope for the snapshots repo |

## Development

```bash
npm test           # vitest unit tests for pure modules (diff, normalize, indexer)
npm run typecheck
npm run build
```

## Status

- [x] Fetch + normalize + semantic diff
- [x] AI summary via Anthropic
- [x] CLI (`fetch`, `diff`, `compare`, `snapshot`)
- [x] PNG rendering with hash-dedupe
- [x] Git + PR flow via simple-git and @octokit/rest
- [x] GitHub Actions cron workflow
- [ ] `HISTORY.md` / `_index.md` auto-update on each snapshot (functions exist in `src/indexer.ts`; not yet wired into `snapshot`)
- [ ] Lucid PNG export endpoint path verified against Lucid docs

## License

MIT
