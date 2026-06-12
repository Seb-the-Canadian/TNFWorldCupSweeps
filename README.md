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

Pick your name (top-right) to highlight your teams and matches across every tab. The
choice is saved in your browser's `localStorage`.

## Enabling GitHub Pages

1. Go to the repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Select the `main` branch and the `/ (root)` folder, then **Save**.
4. Wait a minute, then visit the URL above.

## Editing the data

All pool data is in plain JavaScript objects near the top of the `<script>` block in
`index.html`:

- `P` — participants, their highlight colour, and their two teams.
- `PROB` — each team's outright tournament-winner probability (%).
- `MATCHES` — the full fixture list (date, time, venue, group, flags).
- `GROUPS` — the four teams in each group.

After editing, commit and push to `main` — GitHub Pages redeploys automatically.

> Note: matchday-3 kickoff times/venues and Groups K & L pairings marked `~est.` are
> estimated from the confirmed tournament pattern and should be confirmed once the
> official schedule is finalised.
