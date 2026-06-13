#!/usr/bin/env node
/**
 * schedule.js — refresh guard. Prints "true" when a refresh is worthwhile, so the
 * scheduled Action does real work only during the group stage and goes quiet after.
 *
 * The feed's only kickoff field (local_date) is VENUE-local and can't be converted to a
 * reliable instant without a per-stadium timezone map, so instead of a precise per-match
 * window we use the group-stage date window (UTC). Within it we always refresh; commit-only-
 * on-change (in refresh.js) keeps deploys minimal, and GitHub already throttles the cron.
 *
 * "true" = data/matches.json missing (bootstrap), OR now is within the group stage,
 *          OR the feed still reports a live match.
 *
 *   node scripts/schedule.js   # → "true" | "false"
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "data/matches.json");
// Whole tournament: first game Jun 11; the final is Jul 19 (allow for ET/pens overrun into
// early Jul 20 UTC). The Bracket and Standings depend on knockout results, so the window
// must cover the knockout phase too — not just the group stage.
const START = Date.parse("2026-06-11T00:00:00Z");
const END = Date.parse("2026-07-20T06:00:00Z");

function active() {
  let data;
  try { data = JSON.parse(fs.readFileSync(OUT, "utf8")); }
  catch (e) { return true; } // no file yet → allow the bootstrap fetch

  const now = Date.now();
  if (now >= START && now <= END) return true;
  // Outside the window, only keep refreshing if something is still marked live (group or knockout).
  return [...(data.matches || []), ...(data.knockouts || [])].some((m) => m.status === "live");
}

process.stdout.write(active() ? "true" : "false");
