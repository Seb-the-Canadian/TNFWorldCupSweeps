# TNF World Cup Sweeps

A single-file dashboard for tracking our 2026 World Cup sweepstakes pool — rankings,
schedule, and group ownership for 24 participants. No build step, no dependencies.

**Live site:** once GitHub Pages is enabled (see below), the dashboard is served at
`https://seb-the-canadian.github.io/tnfworldcupsweeps/`.

## How it works

Everything lives in [`index.html`](index.html). Open it in any browser and it just runs.

- **🏆 Rankings** — participants ranked by combined outright tournament-winner
  probability (blended pre-tournament sportsbook odds). Margin not removed; used for
  relative ranking only.
- **📅 Schedule** — all 72 group-stage matches, grouped by day and sorted by kickoff
  time, with owner tags. Filter by group, "My Matches", pool battles, or civil wars.
- **🗂 Groups** — who owns which team in each group, sorted by win probability.

Pick your name (top-right) to highlight your teams and matches across every tab, and
choose a **time zone** to show every kickoff in your own local time (auto-detected by
default). Both choices are saved in your browser's `localStorage`.

Planned improvements live in [`ROADMAP.md`](ROADMAP.md).

## Enabling GitHub Pages

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then merge
to `main`. The [`site.yml`](.github/workflows/site.yml) workflow builds and deploys the site
(and refreshes live data on a schedule). GitHub Actions deployment is required — the
automated data commits use `GITHUB_TOKEN`, which does **not** trigger the classic
"Deploy from a branch" build.

The site is served at `https://seb-the-canadian.github.io/tnfworldcupsweeps/`.

## Live data pipeline (Phase B)

When `data/matches.json` is present, the dashboard overlays live scores and match status
onto the Schedule tab and shows a freshness indicator; when it's absent it renders the
static schedule unchanged. The file is produced by GitHub Actions:

- `scripts/fetch-matches.js` — fetches worldcup26.ir and resolves every team to its
  canonical ID via `data/teams.json` aliases (fails loudly on an unresolved name).
- `scripts/refresh.js` — writes `data/matches.json` only when scores change (or a match is
  live), keeping commits/deploys minimal.
- `scripts/schedule.js` — guards the 5-minute cron so it only works during match windows.

> First-run check: the upstream field names are mapped defensively but unverified. Watch the
> first Actions run; if it errors on team resolution, add the missing alias to
> `data/teams.json` (and run `npm test`).

## Editing the data

All pool data lives in plain JavaScript objects near the top of the `<script>` block in
`index.html`, keyed by **canonical team IDs** (FIFA 3-letter codes — `ESP`, `CIV`, `CPV`…):

- `TEAMS` — every team's ID → display name, group, and win probability (%).
- `POOL` — participants, their highlight colour, and their two team IDs.
- `MATCHES` — the full fixture list (teams referenced by ID; date, time, venue, flags).

Groups, owners, and civil wars are **derived** from the above — no need to edit them.

`index.html` is the source of truth. The canonical files [`data/teams.json`](data/teams.json)
(identity + per-source name aliases) and [`data/pool.json`](data/pool.json) mirror it and are
what the planned data pipeline (see [`docs/analytics-architecture.md`](docs/analytics-architecture.md))
will fetch. After editing the inline data, update those files to match and run:

```
npm test    # node scripts/check-data.js — fails if inline data and data/*.json drift
```

Then commit and push to `main` — GitHub Pages redeploys automatically.

> Note: matchday-3 kickoff times/venues and Groups K & L pairings marked `~est.` are
> estimated from the confirmed tournament pattern and should be confirmed once the
> official schedule is finalised.
