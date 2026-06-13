# TNFifa World Cup 2026 Sweepstakes

A single-file dashboard for tracking our 2026 World Cup sweepstakes pool — live points,
schedule, bracket, and group ownership for 24 participants. No build step, no framework.

**Live site:** https://seb-the-canadian.github.io/TNFWorldCupSweeps/

## How it works

Everything lives in [`index.html`](index.html), served by GitHub Pages; live data is
committed to `data/` by a scheduled GitHub Action.

- **Rankings** — two sub-views with a description box each: **Live Points** (default —
  each participant's running sum of their two teams' match points, win 3 / draw 1 /
  loss 0; knockout shoot-out wins count as wins) and **Pre-Tournament Odds** (combined
  outright-winner probability from blended sportsbook odds; a fixed snapshot).
- **Bracket** — Round-of-32 → Final, owner-coloured; slots show TBD until the group
  stage resolves (Jun 27) and then fill in automatically, including penalty results.
- **Schedule** — all 72 group matches with live scores, grouped by day in your time
  zone. Feed-first: pairings and kickoff times come from the live feed when available.
  Filter by group, "My Matches", pool battles, or civil wars.
- **Groups** — who owns which team in each group, sorted by win probability.

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

## Live data pipeline

`data/matches.json` (group games + a `knockouts` array) is produced by the
[`site.yml`](.github/workflows/site.yml) Action and drives scores, points, and the
bracket. When it's absent the dashboard falls back to its static schedule — no errors.

- `scripts/fetch-matches.js` — fetches worldcup26.ir (`/get/games`, `/get/teams`,
  `/get/stadiums`), joins teams by the feed's `fifa_code` validated against our canonical
  IDs (name-alias fallback; fails loudly on an unresolved group team), computes true UTC
  kickoff instants from venue-local times via a stadium→timezone map, and carries penalty
  shoot-out scores for knockouts.
- `scripts/refresh.js` — writes `data/matches.json` only when results change (or a match
  is live), keeping commits/deploys minimal; scheduled runs deploy only on change.
- `scripts/schedule.js` — guards the cron to the tournament window (Jun 11 – Jul 20 UTC).

The upstream schema was verified against live payloads (2026-06-13). If the feed ever
renames a team, the Action fails loudly with the raw sample — add the alias to
`data/teams.json` and run `npm test`.

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
