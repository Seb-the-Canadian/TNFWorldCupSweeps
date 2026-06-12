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

- [ ] **Phase A — Canonical team identity (no new infra).** Add `data/teams.json` (FIFA-code
      IDs + per-source aliases); refactor `pool.json` + `index.html` to use IDs. Removes the
      biggest failure mode (three sources disagreeing on team-name strings).
- [ ] **Phase B — Live scores & standings.** worldcup26.ir adapter → `matches.json` /
      `standings.json`; refresh Action with inline Pages deploy; loading/stale states in the UI.
- [ ] **Phase C — Probabilities & analytics.** Polymarket Gamma adapter → `probabilities.json`
      + `pool-stats.json`; daily history snapshots; momentum, trajectory chart, conviction signal.

**Verify before building** (couldn't confirm live — sandbox egress blocked the hosts):
Gamma field names on a live `world-cup-winner` response; whether a per-team "to advance"
market exists; worldcup26.ir's real team-name strings (via `/get/teams`); group-winner
slugs B–L.

## Backlog (ideas — reorder/cut as you like)

- **Live results & standings** *(→ Epic Phase B)* — scores per match; group tables; who's advancing.
- **Knockout bracket** — once groups finish, a Round-of-32 → Final bracket coloured by
  owner, with a running "who's still alive" count per participant.
- **Points / leaderboard scoring** — define a scoring system (e.g. points per win,
  bonus for stage reached) and rank participants by points earned, not just pre-tournament odds.
- **Probability momentum & trajectory** *(→ Epic Phase C)* — 24h movers, history chart.
- **"Today" view** — collapse the schedule to just today's (or the next) matches.
- **Share / deep links** — URL params so `?me=Seb&tz=Europe/London` opens pre-configured.
- **Confirm `~est.` fixtures** — replace estimated Group K/L pairings and matchday-3
  times/venues with the official schedule once finalised.
