# WC 2026 Pool Dashboard — Analytics Architecture & Data Schema (Revised)

**Status:** Proposal (revised) · **Last fact-check:** 2026-06-12
**Sources:** worldcup26.ir (scores/standings) · Polymarket Gamma API (probabilities)
**Hosting:** GitHub Pages · **Refresh:** GitHub Actions (scheduled + event-aligned)

> This is a corrected version of the original proposal. Changes from v1 are called out in
> **`▲ CORRECTION`** / **`▲ VERIFY`** callouts. Verified facts and open items are summarised
> in §9. The architecture and both data sources were confirmed real; the main fixes are
> around team-identity joins, the Pages deploy mechanism, change-detection, and slugs.

---

## 1. Repository Structure

This repo's root **is** the project root (no `wc2026-pool/` subfolder).

```
.
├── index.html                    # Dashboard (refactored to fetch JSON instead of inline data)
│
├── data/                         # Generated data — written by Actions, served by Pages
│   ├── meta.json                 # Refresh timestamps, source health, tournament status, resolved slugs
│   ├── teams.json                # ▲ NEW: canonical team IDs + per-source aliases (join key)
│   ├── pool.json                 # STATIC: participant → team-ID mapping (human-maintained)
│   ├── matches.json              # FROM worldcup26.ir — all 104 matches with live scores
│   ├── standings.json            # FROM worldcup26.ir — 12 group tables
│   ├── probabilities.json        # FROM Polymarket — current probs + volume per team
│   ├── history/
│   │   ├── latest.json           # ▲ NEW: pointer/copy of the most recent snapshot
│   │   ├── 2026-06-11.json       # Daily probability snapshots (one file per match day)
│   │   └── ...
│   └── pool-stats.json           # DERIVED: pre-computed participant analytics
│
├── scripts/
│   ├── refresh.js                # Main fetch + transform + validate entry point
│   ├── fetch-matches.js          # worldcup26.ir adapter
│   ├── fetch-probabilities.js    # Polymarket Gamma adapter
│   ├── resolve-slugs.js          # ▲ NEW: resolve + cache all market slugs into meta.json
│   ├── compute-pool-stats.js     # Joins pool + matches + probs → pool-stats.json
│   ├── validate.js               # ▲ NEW: schema-validate before commit; keep last-good on failure
│   └── schedule.js               # Live-window detection (are we live right now?)
│
├── .github/workflows/
│   ├── refresh-live.yml          # Every 5 min during active match windows
│   ├── refresh-standard.yml      # Hourly, date-bounded to the tournament
│   └── refresh-history.yml       # Daily probability snapshot
│
└── package.json
```

---

## 2. Data Schemas

### `data/teams.json` — ▲ NEW: canonical identity (the join key)

**The single most important fix.** Three sources will not agree on team-name strings
(`pool.json` says `"Ivory Coast"`/`"Cabo Verde"`; worldcup26.ir likely says
`"Côte d'Ivoire"`/`"Cape Verde"`/`"Korea Republic"`; Polymarket has a third spelling).
Everything joins on a stable id (FIFA 3-letter code), **never** on display strings.

```json
{
  "ESP": { "display": "Spain",       "group": "H",
           "aliases": { "worldcup26ir": ["Spain"], "polymarket": ["Spain"] } },
  "CIV": { "display": "Ivory Coast", "group": "E",
           "aliases": { "worldcup26ir": ["Côte d'Ivoire", "Ivory Coast"],
                        "polymarket":   ["Ivory Coast"] } },
  "CPV": { "display": "Cabo Verde",  "group": "H",
           "aliases": { "worldcup26ir": ["Cape Verde", "Cabo Verde"],
                        "polymarket":   ["Cape Verde"] } }
  // ... all 48 teams
}
```

> **▲ VERIFY:** Seed the alias arrays by pulling `GET worldcup26.ir/get/teams` and one
> Polymarket market's `outcomes`, then diffing against `pool.json`. Any unmatched team is a
> hard build error — fail loudly rather than silently dropping it.

### `data/pool.json` — Static, human-maintained

Now references **team IDs**, not display names. The only file humans edit.

```json
{
  "pool_name": "WC 2026 Pool",
  "created": "2026-06-10",
  "participants": [
    { "id": "kevin", "display": "Kevin", "color": "#fbbf24", "bg": "rgba(251,191,36,.15)", "teams": ["ESP", "CUW"] },
    { "id": "peter", "display": "Péter", "color": "#ff9500", "bg": "rgba(255,149,0,.15)", "teams": ["FRA", "SWE"] }
    // ... all 24 participants
  ]
}
```

### `data/matches.json` — From worldcup26.ir

Same shape as v1, with two changes: team fields carry **IDs**, and **match identity is the
official match number** — never the dashboard's old invented 1–72 numbering.

```json
{
  "source": "worldcup26.ir", "fetched_at": "2026-06-15T18:42:00Z",
  "matches": [
    { "match_number": 1, "stage": "group", "group": "A", "matchday": 1,
      "kickoff_utc": "2026-06-11T20:00:00Z", "status": "completed",
      "home_id": "MEX", "away_id": "RSA", "home_score": 2, "away_score": 0,
      "home_score_ht": 1, "away_score_ht": 0,
      "stadium": "Estadio Azteca", "city": "Mexico City", "minute": null }
  ]
}
```
`status`: `scheduled | live | completed`. `minute`: current minute if live, else null.

### `data/standings.json` — From worldcup26.ir

Unchanged from v1 except `team` → `team_id`. **▲ CORRECTION:** take `qualified`
directly from worldcup26.ir — do **not** compute it. The 2026 format advances the top 2 of
each group **plus the 8 best third-placed teams** (confirmed), and the best-third ranking
across 12 groups is error-prone to reproduce.

```json
{ "source": "worldcup26.ir", "fetched_at": "2026-06-15T18:42:00Z",
  "groups": { "A": [
    { "position": 1, "team_id": "MEX", "played": 2, "won": 2, "drawn": 0, "lost": 0,
      "gf": 4, "ga": 1, "gd": 3, "points": 6, "form": ["W","W"], "qualified": null }
  ] } }
```
`qualified`: `null | "advance" | "eliminated"` (set after matchday 3, sourced upstream).

### `data/probabilities.json` — From Polymarket Gamma API

**▲ CORRECTION:** the tournament-winner event slug is **`world-cup-winner`** (the public
event), **not** `2026-fifa-world-cup-winner-595`. Do not hardcode any slug — resolve them
all dynamically (see `resolve-slugs.js`) and cache in `meta.json`.

```json
{
  "source": "polymarket", "fetched_at": "2026-06-15T18:42:00Z",
  "markets": {
    "tournament_winner": {
      "event_slug": "world-cup-winner",
      "total_volume_usd": 1900000000, "volume_24h_usd": 66000000,
      "teams": {
        "ESP": { "prob": 0.172, "prob_change_24h": +0.014, "volume_usd": 33600000, "liquidity_usd": 4200000 }
        // ... keyed by team ID; prob_change_24h from Gamma's rolling field, NOT a daily snapshot
      }
    },
    "group_winners": {
      "A": { "event_slug": "world-cup-group-a-winner", "volume_usd": 284000,
             "teams": { "MEX": { "prob": 0.61, "prob_change_24h": +0.07 } } }
    },
    "to_advance": {}   // ▲ VERIFY market exists; if not, omit and label group_win_prob honestly
  }
}
```

> **▲ CORRECTION — probability baselines:**
> - **24h delta** → from Gamma's own rolling change field (`oneDayPriceChange`; ▲ verify exact
>   field name on a live response). This is a true rolling 24h, more accurate than diffing the
>   once-daily snapshot.
> - **From-start delta & trajectory chart** → from `history/*.json`. There is no
>   "tournament start" value in the API; the baseline is the day-1 snapshot you captured.
> - **Display normalization:** raw Gamma mid-prices across 48 teams will not sum to 100%
>   (independent markets + vig). Normalize for display; keep raw for the conviction signal.
> - **Missing/thin markets** (Curaçao, Jordan, Uzbekistan, etc. may have no liquid market):
>   define a fallback (`0`, or last-known from history) so a missing team never `NaN`s a
>   participant's combined sum.

### `data/history/YYYY-MM-DD.json` — Daily snapshots (+ `latest.json`)

One file per day (keyed by team ID), plus a `latest.json` so the transform doesn't have to
list the directory. ~4 KB × 39 days ≈ 156 KB total — negligible.

```json
{ "date": "2026-06-15", "snapshot_utc": "2026-06-15T23:59:00Z",
  "tournament_winner_probs": { "ESP": 0.172, "FRA": 0.161 },
  "group_winner_probs": { "A": { "MEX": 0.61, "KOR": 0.22, "CZE": 0.15, "RSA": 0.02 } } }
```

### `data/pool-stats.json` — Derived analytics (powers the UI)

Same rich shape as v1 (rank, deltas, per-team standings, analytics block: `biggest_movers_24h`,
`most_volatile_24h`, `civil_wars`, `volume_signal`) — with two corrections:
- All teams keyed/identified by **ID**.
- `civil_wars[].match_number` is **derived** from the fixtures (find the match where a
  participant owns both teams), not hardcoded as `40`/`66`.

### `data/meta.json` — Operational health + resolved slugs

As v1, plus a `resolved_slugs` block written by `resolve-slugs.js` so adapters never assume a
slug pattern. `refresh_mode`: `live | standard | idle`; `sources.*.status`: `ok | degraded | down`.

```json
{ "last_refresh": "2026-06-15T18:42:00Z", "refresh_mode": "live",
  "resolved_slugs": { "tournament_winner": "world-cup-winner",
                      "group_winners": { "A": "world-cup-group-a-winner" } },
  "sources": { "worldcup26ir": { "status": "ok", "last_success": "...", "last_error": null },
               "polymarket":   { "status": "ok", "last_success": "...", "last_error": null } },
  "tournament": { "status": "active", "phase": "group_stage",
                  "live_matches": [14, 15], "next_kickoff_utc": "2026-06-15T23:00:00Z" } }
```

---

## 3. Source Mapping (corrected)

| Data | Source | Endpoint | Frequency |
|---|---|---|---|
| Match scores & status | worldcup26.ir | `GET /get/games` | 5 min when live |
| Group standings | worldcup26.ir | `GET /get/groups` | 5 min when live |
| Team list (alias seeding) | worldcup26.ir | `GET /get/teams` | once / on demand |
| Tournament win prob | Polymarket Gamma | `GET /events?slug=world-cup-winner` ◀ corrected | 5 min when live |
| Group win prob | Polymarket Gamma | `GET /events?slug=world-cup-group-{a–l}-winner` (resolve dynamically) | 30 min |
| Prob price history | Polymarket CLOB | `GET /prices-history?market={token_id}&interval=1w&fidelity=1440` | once daily |
| Pool config | Static `pool.json` | n/a | manual |

All sources are public (no API keys → no Actions secrets needed). worldcup26.ir is an
unofficial Express/MongoDB API — a single point of failure, which is why the `meta.sources`
degraded-handling matters.

---

## 4. GitHub Actions & Pages deployment

> **▲ CORRECTION — how the site actually publishes.** Two confirmed platform facts change the
> v1 workflows: (1) commits pushed with the default `GITHUB_TOKEN` **do not trigger** the
> `pages-build-deployment` build, so bot data-commits would never publish via "Deploy from a
> branch"; (2) the Pages **~10 builds/hour** soft limit **does not apply** when you publish via
> a custom Actions workflow. **Resolution:** set Pages source to **GitHub Actions** and have the
> refresh workflow **deploy inline** (`upload-pages-artifact` → `deploy-pages`) after writing
> data. This removes both the trigger problem and the build-rate cap in one move.

Shared requirements across all three workflows:
- `permissions: { contents: write, pages: write, id-token: write }`
- `concurrency: { group: data-refresh, cancel-in-progress: false }` — **prevents push races**
  when `refresh-live` and `refresh-standard` fire on the same minute.
- Commit step must be race-safe and only commit on **substantive** change:

```bash
# ▲ CORRECTION: explicit if-block (the v1 `A || B && C` ran push even on no-op);
# and change-detection must ignore volatile timestamps so we don't commit every 5 min.
git add data/
if ! git diff --staged --quiet -- $(git diff --staged --name-only | grep -v 'meta.json'); then
  git pull --rebase origin main || true
  git commit -m "data($MODE): $(date -u +%FT%TZ)"
  for i in 1 2 3; do git push && break || { git pull --rebase origin main; sleep $((2**i)); }; done
fi
```

`refresh.js` should write each data file **only when its meaningful content changed**
(compare excluding `fetched_at`), so the diff above is usually empty on no-op runs — keeping
deploys well under any rate limit. After data is committed, the same job runs the Pages
deploy steps.

- **`refresh-live.yml`** — `cron: '*/5 * * * *'` (5 min is GitHub's floor; expect 5–30 min
  drift at busy times). Guarded by `schedule.js`, which returns `true` only if a match kicked
  off in the **last ~2.5h** (matches run long) or starts in the next 30 min — preventing
  thousands of no-op runs.
- **`refresh-standard.yml`** — `cron: '0 * * * *'`, but `schedule.js` gates it to the
  tournament window (**Jun 11 – Jul 19 2026**); cron has no date range on its own.
- **`refresh-history.yml`** — `cron: '55 23 * * *'` (after the last possible match).

> Note: the 60-day idle auto-disable of scheduled workflows is a non-issue during the
> tournament (bot commits count as activity), but it means these should be enabled now /
> close to kickoff, not months early.

---

## 5. Transform & validate (`refresh.js` → `compute-pool-stats.js` → `validate.js`)

```
teams.json (join key) + pool.json + matches.json + standings.json
  + probabilities.json + history/latest.json
  ──────────────────────────────────────────────────────────────
  → pool-stats.json   (validate before commit; on failure keep last-good + mark source degraded)
```

Per-participant: `tournament_prob_combined` (sum of both teams' current win prob, normalized
for display), `prob_delta_24h` (Gamma rolling field), `prob_delta_from_start` (vs day-1
snapshot), `rank`, `rank_change_24h`, plus the analytics block.

---

## 6. Dashboard fetch strategy

```
On load:  meta.json · pool.json (or inlined) · pool-stats.json · matches.json
Groups tab (lazy): standings.json
History chart (lazy, on demand): history/YYYY-MM-DD.json
```

- **▲ CORRECTION — caching:** Pages serves `Cache-Control: max-age=600` (10 min) and it
  can't be customized. So the 60-second live poll of `meta.json` (and `pool-stats.json`)
  **must** use `fetch(url, { cache: 'no-store' })` or a `?t=Date.now()` cache-buster, or the
  browser will serve a 10-minute-stale copy and the "data may be stale" indicator will lie.
- **▲ NEW — graceful degradation:** ship a bundled last-known snapshot (or keep the current
  inline `P`/`PROB`/`MATCHES` objects as a fallback) so the page never renders empty if a
  fetch fails or Actions break. Inlining `pool.json` also improves first paint.
- Same-origin only → no CORS concerns in the browser (the Action is the cross-origin fetch
  layer; worldcup26.ir CORS headers are therefore irrelevant).

---

## 7. Analytics this unlocks

Live rankings · 24h probability momentum · ranking movement · biggest-movers heat map · live
group standings & advancement · civil-war countdown + market favourite · probability
trajectory chart · crowd-conviction (volume) signal · "lucky draw vs earned" (start vs now) ·
upset detector (result vs pre-match prob). All computable from the schema above, no extra
sources.

---

## 8. Build phasing

- **Phase A — De-risk identity (no new infra):** create `teams.json`, refactor `pool.json`
  and `index.html` to team IDs. Ships value immediately and removes the biggest failure mode.
- **Phase B — Live scores:** one Action + `matches.json` / `standings.json` + inline Pages
  deploy. This is the thing people actually want live.
- **Phase C — Probabilities & analytics:** Polymarket adapter, `pool-stats.json`, history
  snapshots, momentum/trajectory UI.

---

## 9. Verification status (fact-checked 2026-06-12)

**Confirmed:** worldcup26.ir endpoints (`/get/games`, `/get/groups`, `/get/teams`), public &
no-auth · Polymarket Gamma public/read-only/no-key · example probs & $1.9B volume are live-real
· 104 matches / 48 teams / 12 groups, top-2 + 8 best-thirds advance · group stage Jun 11–27,
final Jul 19 · Actions 5-min cron floor + 5–30 min drift + 60-day idle disable · Pages
`max-age=600` (uncustomizable) · GITHUB_TOKEN pushes don't trigger Pages build · Pages 10/hr
limit exempt for custom Actions deploy.

**Corrected:** tournament-winner slug is `world-cup-winner` (not `…-595`) · publish via inline
Actions deploy (not branch-deploy + PAT) · `prob_at_start` is a captured snapshot, not an API
field · `qualified` sourced upstream, not computed · join on IDs, not strings · derive
match/civil-war identities, don't hardcode.

**Still to verify before/at build (could not confirm live — sandbox egress + Cloudflare 403):**
1. Exact Gamma field names (`oneDayPriceChange`, event-level `volume_24h`, `outcomePrices`) —
   check one live `events?slug=world-cup-winner` response.
2. Whether a per-team **"to advance/qualify"** Polymarket market exists (only outright +
   group-winner confirmed).
3. worldcup26.ir's exact response field names and the real team-name strings (drives
   `teams.json` aliases) — pull `/get/teams`.
4. Group-winner slugs B–L (resolve dynamically; only A confirmed).
