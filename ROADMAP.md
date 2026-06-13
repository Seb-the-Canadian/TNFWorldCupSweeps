# Roadmap

Tracking improvements to the World Cup pool dashboard. Items move from **Backlog** →
**In progress** → **Shipped**. Edit freely to reprioritise.

## Shipped

### 1. Timezone picker
A selector (top-right) that shows every match start in the viewer's chosen time zone,
not just Eastern.
- Kickoffs are stored as ET and converted to a true UTC instant, then formatted with
  `Intl.DateTimeFormat` in the selected zone — DST-correct on both ends.
- The schedule's **day headers regroup by the selected zone**, so a late ET game lands
  on the correct local calendar date (e.g. 10 PM ET Jun 11 → 3 AM Jun 12 in the UK).
- Defaults to **auto-detect from the device** (falls back to Eastern); choice is saved
  per browser. Zones offered: Eastern, Central, Mountain, Pacific, UK, Central Europe.

## Epic: Live data & analytics backend

A pipeline that feeds the dashboard live scores, group standings, and market-implied
probabilities, with a precomputed analytics layer — all on free, serverless infra
(GitHub Actions writes JSON to the repo; GitHub Pages serves it).

**Design & schema:** [`docs/analytics-architecture.md`](docs/analytics-architecture.md)
(proposal reviewed and fact-checked 2026-06-12 — sources and platform limits confirmed;
team-identity joins, Pages deploy method, slugs, and change-detection corrected).

Subsumes several backlog items below (live results & standings, momentum, history chart,
civil-war countdown, conviction signal). Phased to ship value early and de-risk first:

- [x] **Phase A — Canonical team identity (no new infra).** ✅ `data/teams.json` (FIFA-code
      IDs + per-source aliases) and `data/pool.json` added; `index.html` refactored to an
      ID-keyed `TEAMS`/`POOL` model (groups, owners, and civil wars now *derived*, not
      hardcoded). `scripts/check-data.js` (`npm test`) guards inline↔JSON drift. Removes the
      biggest failure mode (three sources disagreeing on team-name strings).
- [ ] **Phase B — Live scores & standings.** *In progress.*
      - ✅ **Client live layer** (`index.html`): fetches `data/matches.json` (no-store, 60s
        poll), overlays scores + LIVE/FULL-TIME status onto the schedule, shows a
        freshness pill, and joins on team IDs (re-orienting scores). Zero regression —
        renders the static schedule unchanged when no data file exists.
      - ✅ **Pipeline scaffolding** (`scripts/`, `.github/workflows/site.yml`): worldcup26.ir
        adapter (alias-resolved, fail-safe), refresh orchestrator (writes only on
        change/live heartbeat), live-window guard, and inline Pages deploy with
        concurrency + race-safe commits.
      - ⏳ **Activate:** set Pages Source to *GitHub Actions* and merge to `main`; confirm
        the upstream field names on the first real run (see "verify" below). Then add
        standings → live group tables (Phase B-2).
- [ ] **Phase C — Probabilities & analytics.** Polymarket Gamma adapter → `probabilities.json`
      + `pool-stats.json`; daily history snapshots; momentum, trajectory chart, conviction signal.

**Verify before building** (couldn't confirm live — sandbox egress blocked the hosts):
Gamma field names on a live `world-cup-winner` response; whether a per-team "to advance"
market exists; worldcup26.ir's real team-name strings (via `/get/teams`); group-winner
slugs B–L.

## Backlog (ideas — reorder/cut as you like)

- **Live results & standings** *(→ Epic Phase B)* — scores per match; group tables; who's advancing.
- [x] **Points / leaderboard scoring** ✅ — "Standings" tab (now the default landing view):
  each participant ranked by the sum of their two teams' match points (win 3 / draw 1 /
  loss 0), computed live from `matches.json` completed results. Odds moved to a secondary tab.
- **Knockout bracket** *(next — has content from Jun 27)* — Round-of-32 → Final bracket
  coloured by owner, fed by the knockout `type` rows once teams are set; a running
  "who's still alive" count per participant. Pairs with the Standings tab.
- **Probability momentum & trajectory** *(→ Epic Phase C)* — 24h movers, history chart.
- **"Today" view** — collapse the schedule to just today's (or the next) matches.
- **Share / deep links** — URL params so `?me=Seb&tz=Europe/London` opens pre-configured.
- **Confirm `~est.` fixtures** — replace estimated Group K/L pairings and matchday-3
  times/venues with the official schedule once finalised.
