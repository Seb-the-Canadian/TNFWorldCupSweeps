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
- [x] **Phase B — Live scores.** ✅ Shipped and verified end-to-end (2026-06-13): the
      worldcup26.ir adapter (fifa_code join validated against canonical IDs, stadium-tz
      kickoff instants, penalty scores, knockouts array), change-only refresh + deploy,
      tournament-window guard (Jun 11 – Jul 20), and the client live layer (feed-first
      schedule, scores/LIVE/FT overlay, freshness pill, 60s poll). Schema confirmed
      against live payloads. *Remaining idea:* live group W/D/L tables on the Groups tab
      (feed `/get/groups`).
- [ ] **Phase C — Probabilities & analytics.** Polymarket Gamma adapter → `probabilities.json`
      + `pool-stats.json`; daily history snapshots; momentum, trajectory chart, conviction signal.

**Verify before building Phase C:** Gamma field names on a live `world-cup-winner`
response; whether a per-team "to advance" market exists; group-winner slugs B–L.
(The worldcup26.ir items from the original list are now confirmed from live data.)

## Backlog (ideas — reorder/cut as you like)

- [x] **Live results** ✅ *(→ Epic Phase B)* — scores per match, live on the Schedule tab.
  Live group W/D/L tables (feed `/get/groups`) remain a future idea.
- [x] **Points / leaderboard scoring** ✅ — "Live Points" sub-view of the combined
  **Rankings** page (the default landing view, with Pre-Tournament Odds as the second
  sub-view): each participant ranked by the sum of their two teams' match points
  (win 3 / draw 1 / loss 0; knockout shoot-out wins count as wins).
- [x] **Knockout bracket** ✅ — "Bracket" tab: Round-of-32 → Final (+ third place) rounds
  coloured by owner, fed by the knockout rows from the feed. Shows TBD slots now and fills
  in automatically once the draw resolves (Jun 27); completed knockout results count toward
  the Standings points. Future polish: connector lines and a "still alive per participant" tally.
- **Probability momentum & trajectory** *(→ Epic Phase C)* — 24h movers, history chart.
- **"Today" view** — collapse the schedule to just today's (or the next) matches.
- **Share / deep links** — URL params so `?me=Seb&tz=Europe/London` opens pre-configured.
- **Confirm `~est.` fixtures** — replace estimated Group K/L pairings and matchday-3
  times/venues with the official schedule once finalised.
