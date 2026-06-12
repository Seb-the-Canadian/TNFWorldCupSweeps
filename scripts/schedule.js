#!/usr/bin/env node
/**
 * schedule.js — live-window guard. Prints "true" when a refresh is worthwhile, so the
 * 5-minute Action skips the thousands of no-op runs on quiet hours.
 *
 * "Worthwhile" = data/matches.json is missing (bootstrap), OR any match is currently
 * marked live, OR any match kicks off within the next 30 min or kicked off within the
 * last 2.5h (matches run long, including stoppage/half-time).
 *
 *   node scripts/schedule.js   # → "true" | "false"
 */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "data/matches.json");
const MIN = 60 * 1000, HOUR = 60 * MIN;

function active() {
  let data;
  try { data = JSON.parse(fs.readFileSync(OUT, "utf8")); }
  catch (e) { return true; } // no file yet → allow the bootstrap fetch

  const now = Date.now();
  return (data.matches || []).some((m) => {
    if (m.status === "live") return true;
    const k = Date.parse(m.kickoff_utc);
    if (!isFinite(k)) return false;
    return k <= now + 30 * MIN && k >= now - 2.5 * HOUR;
  });
}

process.stdout.write(active() ? "true" : "false");
