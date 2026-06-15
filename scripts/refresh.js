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
const OUT_HIST = path.join(ROOT, "data/history.json");

// One probability point per UTC day for the trajectory sparkline. Upsert today's entry from
// the latest odds; write only when today's rounded map changed. Tiny (~48 teams × ≤45 days).
function upsertHistory(odds) {
  let h = { days: [] };
  try { h = JSON.parse(fs.readFileSync(OUT_HIST, "utf8")); } catch (e) {}
  if (!Array.isArray(h.days)) h.days = [];
  const date = new Date().toISOString().slice(0, 10);
  const teams = {}; Object.keys(odds.teams).forEach((id) => { teams[id] = odds.teams[id].prob; });
  const i = h.days.findIndex((d) => d.date === date);
  if (i >= 0 && JSON.stringify(h.days[i].teams) === JSON.stringify(teams)) return; // today unchanged
  if (i >= 0) h.days[i] = { date, teams }; else h.days.push({ date, teams });
  h.days.sort((a, b) => a.date.localeCompare(b.date));
  if (h.days.length > 45) h.days = h.days.slice(-45);
  h.updated = new Date().toISOString();
  fs.mkdirSync(path.dirname(OUT_HIST), { recursive: true });
  fs.writeFileSync(OUT_HIST, JSON.stringify(h) + "\n");
  console.log(`wrote data/history.json — ${h.days.length} day(s)`);
}

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
  // daily trajectory point — upsert regardless of whether the live odds file changes
  try { upsertHistory(next); } catch (e) { console.warn("history upsert skipped: " + e.message); }
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
