#!/usr/bin/env node
/**
 * refresh.js — pipeline entry point (run by GitHub Actions).
 *
 * Fetches the match feed and writes data/matches.json ONLY when the substantive
 * content changed (ignoring the fetched_at timestamp) or a match is currently live
 * (a heartbeat so the freshness indicator stays green during games). This keeps
 * commits/deploys minimal off-match and frequent during live windows.
 *
 *   node scripts/refresh.js
 */
const fs = require("fs");
const path = require("path");
const { fetchMatches } = require("./fetch-matches");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data/matches.json");

async function main() {
  const next = await fetchMatches();

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch (e) {}

  const sameContent = prev && JSON.stringify(prev.matches) === JSON.stringify(next.matches);
  const anyLive = next.matches.some((m) => m.status === "live");

  if (sameContent && !anyLive) {
    console.log("no change (and nothing live) — leaving data/matches.json untouched");
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  console.log(`wrote data/matches.json — ${next.matches.length} matches${anyLive ? " (live)" : ""}`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
