#!/usr/bin/env node
/**
 * refresh.js — pipeline entry point (run by GitHub Actions).
 *
 * 1) Matches (required): writes data/matches.json ONLY when the substantive content
 *    changed (ignoring fetched_at) or a match is currently live (a heartbeat so the
 *    freshness indicator stays green during games).
 * 2) Odds (best-effort): writes data/probabilities.json when the rounded market map
 *    changed. Never fatal — a Polymarket hiccup must not affect match refresh/deploy.
 *
 * Each file is committed only when it actually changes, so off-match runs stay quiet.
 *
 *   node scripts/refresh.js
 */
const fs = require("fs");
const path = require("path");
const { fetchMatches } = require("./fetch-matches");
const { fetchOdds } = require("./fetch-odds");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data/matches.json");
const OUT_ODDS = path.join(ROOT, "data/probabilities.json");

async function refreshMatches() {
  const next = await fetchMatches();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}
  const sameContent = prev
    && JSON.stringify(prev.matches) === JSON.stringify(next.matches)
    && JSON.stringify(prev.knockouts || []) === JSON.stringify(next.knockouts || []);
  const anyLive = [...next.matches, ...(next.knockouts || [])].some((m) => m.status === "live");
  if (sameContent && !anyLive) { console.log("matches: no change (nothing live) — untouched"); return; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote data/matches.json — ${next.matches.length} group + ${(next.knockouts || []).length} knockout${anyLive ? " (live)" : ""}`);
}

async function refreshOdds() {
  const next = await fetchOdds();
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT_ODDS, "utf8")); } catch (e) {}
  // compare only the rounded team map, so tiny price wiggles don't churn commits
  if (prev && JSON.stringify(prev.teams) === JSON.stringify(next.teams)) { console.log("odds: no change — untouched"); return; }
  fs.mkdirSync(path.dirname(OUT_ODDS), { recursive: true });
  fs.writeFileSync(OUT_ODDS, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote data/probabilities.json — ${Object.keys(next.teams).length} teams`);
}

async function main() {
  let failed = false;
  try { await refreshMatches(); } catch (e) { console.error("ERROR (matches): " + e.message); failed = true; }
  // Odds are best-effort: a failure here is a warning, never a non-zero exit on its own.
  try { await refreshOdds(); } catch (e) { console.warn("odds refresh skipped: " + e.message); }
  if (failed) process.exitCode = 1; // surface a real match-feed failure (workflow keeps last-good)
}

main();
