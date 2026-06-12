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

## Backlog (ideas — reorder/cut as you like)

- **Live results & standings** — enter scores per match; compute group tables and show
  which owners are advancing.
- **Knockout bracket** — once groups finish, a Round-of-32 → Final bracket coloured by
  owner, with a running "who's still alive" count per participant.
- **Points / leaderboard scoring** — define a scoring system (e.g. points per win,
  bonus for stage reached) and rank participants by points earned, not just pre-tournament odds.
- **"Today" view** — collapse the schedule to just today's (or the next) matches.
- **Share / deep links** — URL params so `?me=Seb&tz=Europe/London` opens pre-configured.
- **Auto-updating odds** — refresh `PROB` from a data source instead of hand-editing.
- **Confirm `~est.` fixtures** — replace estimated Group K/L pairings and matchday-3
  times/venues with the official schedule once finalised.
