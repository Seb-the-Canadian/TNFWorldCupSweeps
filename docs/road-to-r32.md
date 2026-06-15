# Road to R32 — "Path to Advancing" view (design note)

**Status:** Proposed · backlogged (build after the current backlog is cleared)
**Recommendation:** ship deterministic **Tier 1 + Tier 2** first; treat probabilistic
**Tier 3** as a later, clearly-labelled add-on.

## Goal
A per-**team** and per-**participant** view answering: *what does it take to reach the
Round of 32?* — current status, the requirement for the next match, and (for participants)
the combined fate of their two teams.

## The format that shapes the problem (2026)
12 groups of 4. Advancing = **top 2 of each group (24)** + the **8 best third-placed teams**
ranked across all 12 groups (pts → GD → GF → goals scored → …). Top-2 is **group-local and
easy** to reason about; the **best-third spot is cross-group** and is the hard part of any
"path" feature.

## Data we have (no new sources needed for Tier 1/2)
- Live results + standings — already computed by `groupStandings()` in `index.html`.
- Remaining fixtures with correct pairings — `data/matches.json` (feed-first).
- **Not** available: per-*match* win probabilities. The only probability signal is the
  *tournament-winner* odds in `TEAMS[].prob`, which is not a clean match model (Tier 3 only).

## Fidelity tiers

### Tier 1 — Deterministic status & next-match requirement (no model, exact)
Brute-force the remaining results **within a team's own group** (≤ 3^remaining = at most a
few dozen combinations) and classify each team: **Clinched top-2 / Eliminated / Still alive**,
plus a plain-English requirement, e.g. *"Beat Cabo Verde to clinch; a draw also does it
unless Uruguay win."* Cheap, explainable, reuses existing standings logic.

### Tier 2 — Best-third race (deterministic; the elegant answer to the cross-group problem)
Rank all twelve third-placed teams by pts/GD/GF with a **cut line after 8**; show each as
provisionally in/out. This shows the *bar* rather than asserting a premature binary clinch,
which is the honest way to present a spot that isn't decided until every group finishes.

### Tier 3 — Probabilistic "% to advance" (later, optional)
Derive relative team strength from the outright odds → a simple match model → Monte-Carlo
the remaining group games **including the best-third ranking** → "Norway 78% to advance,
41% to win the group." Genuinely engaging, but: soft numbers (modelling assumption we lack
clean inputs for), heaviest lift, and must be labelled "model estimate." Naturally dovetails
with **Phase C** if we ever get live market-implied numbers (Polymarket Gamma).

## Participant rollup (any tier)
Combine each person's two teams into one line, e.g.
*"Seb — Norway (2nd, through) · Ivory Coast (3rd, provisionally in) → still alive on both."*
Headline metric: **still alive** count. This is the pool-specific payoff; pairs naturally
with the Live Points view.

## Placement options (decision pending)
- **A — new "Road to R32" tab:** participant rollup at top, group-by-group statuses,
  third-place race below.
- **B — fold in:** team status chips on the **Groups** tab + a third-place-race panel, with
  the participant rollup on the **Rankings / Live Points** view. Less new surface, more scattered.

## Computation notes / gotchas
- Reuse `groupStandings()`; add a scenario solver that enumerates remaining group results.
- We model tiebreakers as **pts → GD → GF only** (no head-to-head / fair-play / drawing of
  lots) — so a knife-edge "clinched" can be wrong; **hedge wording** ("on current tiebreakers").
- Best-third qualification is **provisional** until all groups finish → present Tier 2 as a
  race, never a premature "clinched via third."
- In-play matchday 3 (simultaneous final games) is where this shines, but the deterministic
  scenarios assume **final** results.

## Phasing
1. **Tier 1 + Tier 2 deterministic** — the feature.
2. **Tier 3 probabilities** — optional later layer (pairs with Phase C market data).

## Open questions to resolve before building
1. **Fidelity:** deterministic (Tier 1+2) first, or is the probabilistic "%" required?
2. **Placement:** dedicated tab vs. fold into Groups + Rankings.
3. **Emphasis:** team-centric (group qualification) or participant-centric (your two teams' combined fate) as the headline.
