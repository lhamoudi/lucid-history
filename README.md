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
                                    commit {JSON, PNGs, summary.md}
                                                              ↓
                                               open PR on snapshots repo
                                                              ↓
                            copy doc to Lucid __AUTOMATED_SNAPSHOTS folder
                                                              ↓
                                          squash-merge PR + delete branch
```

The semantic diff keys shapes and lines by their stable Lucid IDs and reports: added/removed/renamed pages, added/removed/text-changed/class-changed shapes, and added/removed/rewired/label-changed lines. Layout coordinates are not in the source data at all, so pure "drag this block" edits produce no diff.

## Lucid API limitations

Lucid's REST API exposes the current state of a document but [does not provide access to saved version history](https://community.lucid.co/developer-community-6/reterive-a-lucidchart-document-like-the-in-saved-versions-6968). There is no endpoint to retrieve a past snapshot or enumerate the versions you see in the Lucid UI. This tool exists to close that gap by taking periodic snapshots and persisting them in Git, giving you a diffable history that Lucid itself doesn't expose.

A second gap remains even with this approach: the API carries no authorship or fine-grained timestamp information per change. We can detect *what* changed between two snapshots, but we cannot attribute individual edits to a specific person or a precise time — only to the window between two snapshot runs.

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
npx lucid-history compare <base-doc-id> <head-doc-id> --raw          # DocDiff JSON only, no AI
npx lucid-history compare <base-doc-id> <head-doc-id> --out ./out    # write PNGs + summary to dir
npx lucid-history compare <base-doc-id> <head-doc-id> --skip-renders # skip PNG exports
```

Fetches both documents live and prints an AI-generated summary of structural differences. Useful when you restore an old version of a document in Lucid (which creates a new doc ID) and want to compare it against the current version. With `--out`, writes `summary.md` and per-page before/after PNGs into the specified directory.

### `snapshot` — full daily pipeline

```bash
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo --dry-run
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo --skip-renders
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo --lucid-folder <folder-id>
npx lucid-history snapshot <doc-id> --repo your-org/your-snapshots-repo --auto-merge
```

`--skip-renders` bypasses PNG export — useful while the Lucid PNG endpoint is being validated.

`--auto-merge` squash-merges the PR immediately after opening it, then deletes the snapshot branch. Skipped in `--dry-run`. Requires the `GITHUB_TOKEN` to have write access to the snapshots repo.

`--lucid-folder <id>` copies the live document directly into the given Lucid folder, titled `SNAPSHOT_<doc-title>_<YYYY-MM-DD>`. A link is appended to both the snapshot `summary.md` and the PR body. The folder ID can be found in the Lucid URL (`folder_id=...`). Omit the flag to skip this step.

No prior snapshot? The first run creates an "initial snapshot" commit with no summary.
No material changes since last snapshot? No commit, no PR — the command exits silently.

## Snapshots repo layout

The tool writes to the snapshots repo with this structure:

```
snapshots/
  <doc-title>___<doc-id>/
    latest.json                              copy of most recent snapshot
    HISTORY.md                               chronological table of all snapshots
    2026-04-22T10-30-00Z/
      snapshot.json                          full normalized document JSON
      summary.md                             the PR body, archived
      <page-title>___<page-id>.png           one per changed page (only when changed)
```

Folder names use the convention `<human-readable-name>___<id>` so the identifier is always unambiguous. Both doc titles and page names are sanitized (`[^a-zA-Z0-9_-]` → `_`); IDs are appended verbatim after `___`.

## GitHub Actions

Three ready-to-use workflows are provided:

| Workflow | Trigger | Purpose |
|---|---|---|
| [`daily-snapshot.yml`](.github/workflows/daily-snapshot.yml) | Schedule (Mon–Fri 09:00 UTC) + manual | Snapshots every doc in `docs.json` |
| [`manual-snapshot.yml`](.github/workflows/manual-snapshot.yml) | Actions tab → Run workflow | Snapshot a single doc ID or all docs; supports `--dry-run`; auto-merge opt-in (default off) |
| [`compare.yml`](.github/workflows/compare.yml) | Actions tab → Run workflow | Compare two live doc IDs; summary shown inline, PNGs uploaded as ZIP artifact |

Fill in `<your-org>/<your-snapshots-repo>` in the snapshot workflows, then add these secrets:

| Secret | Used by | Description |
|---|---|---|
| `LUCID_API_KEY` | all | Lucid REST API key |
| `ANTHROPIC_API_KEY` | all | Anthropic API key |
| `SNAPSHOTS_GITHUB_TOKEN` | snapshot workflows | GitHub PAT with `repo` scope for the snapshots repo |

## Development

```bash
npm test           # vitest unit tests for pure modules (diff, normalize)
npm run typecheck
npm run build
```

## Status

- [x] Fetch + normalize + semantic diff
- [x] AI summary via Anthropic
- [x] CLI (`fetch`, `diff`, `compare`, `snapshot`)
- [x] PNG rendering with hash-dedupe
- [x] Git + PR flow via simple-git and @octokit/rest
- [x] GitHub Actions workflows (daily, manual, compare)
- [x] Lucid snapshot copies via `--lucid-folder`
- [x] Auto-merge + branch deletion via `--auto-merge`
- [x] `HISTORY.md` per-doc snapshot log (date, page counts, affected pages, AI theme blurb)
- [x] Lucid PNG export verified and working

## License

MIT
