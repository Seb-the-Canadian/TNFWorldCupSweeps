#!/usr/bin/env node
/**
 * fetch-matches.js — worldcup26.ir → data/matches.json (Phase B).
 *
 * Fetches the match feed, resolves every team to a canonical FIFA ID via
 * data/teams.json aliases, and emits the matches.json contract the dashboard reads:
 *
 *   { source, fetched_at, matches: [
 *       { group, matchday, match_number, kickoff_utc,
 *         home_id, away_id, status: "scheduled"|"live"|"completed",
 *         home_score, away_score, minute } ] }
 *
 * ⚠ The upstream field NAMES are UNVERIFIED (the host is unreachable from the dev
 *   sandbox). `normalizeMatch` therefore reads from several likely field names, and
 *   `fetchMatches` THROWS on any unresolved team or empty payload — so a wrong guess
 *   fails the Action loudly and keeps the last-good data rather than publishing garbage.
 *   Confirm names on the first real Actions run (or via `--selftest`) and tighten here.
 *
 *   node scripts/fetch-matches.js            # fetch + print contract JSON
 *   node scripts/fetch-matches.js --selftest # offline: prove alias resolution/mapping
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const UPSTREAM = "https://worldcup26.ir/get/games";

const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const numOrNull = (x) => { if (x === "" || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };

// alias / display / id → canonical team ID
function buildResolver() {
  const teams = JSON.parse(fs.readFileSync(path.join(ROOT, "data/teams.json"), "utf8")).teams;
  const idx = new Map();
  const add = (s, id) => { if (s) idx.set(norm(s), id); };
  for (const [id, t] of Object.entries(teams)) {
    add(id, id); add(t.display, id);
    const a = t.aliases || {};
    [].concat(a.worldcup26ir || [], a.polymarket || []).forEach((x) => add(x, id));
  }
  return idx;
}
const resolve = (idx, name) => (name == null ? null : idx.get(norm(name)) || null);

function parseGroup(g) {
  if (g == null) return null;
  const c = String(g).replace(/group/ig, "").replace(/[^a-lA-L]/g, "").toUpperCase();
  return c ? c[0] : null;
}
function mapStatus(s) {
  if (s == null) return "scheduled";
  s = String(s).toLowerCase();
  if (/(finish|full|ft|complete|ended|played|aet|pen)/.test(s)) return "completed";
  if (/(live|playing|in.?progress|1st|2nd|half|on.?air|paused|break)/.test(s)) return "live";
  return "scheduled";
}

function normalizeMatch(raw, idx) {
  const homeName = pick(raw, ["home_team", "homeTeam", "home", "team1", "homeName", "home_name", "teamA"]);
  const awayName = pick(raw, ["away_team", "awayTeam", "away", "team2", "awayName", "away_name", "teamB"]);
  return {
    group: parseGroup(pick(raw, ["group", "group_name", "groupName", "groupLetter"])),
    matchday: numOrNull(pick(raw, ["matchday", "round", "match_day", "week"])),
    match_number: numOrNull(pick(raw, ["match_number", "number", "matchNumber", "id", "matchId"])),
    kickoff_utc: pick(raw, ["kickoff_utc", "utcDate", "datetime", "dateUtc", "date", "kickoff"]) || null,
    home_id: resolve(idx, homeName),
    away_id: resolve(idx, awayName),
    status: mapStatus(pick(raw, ["status", "state", "match_status", "matchStatus"])),
    home_score: numOrNull(pick(raw, ["home_score", "homeScore", "score_home", "home_goals", "scoreA"])),
    away_score: numOrNull(pick(raw, ["away_score", "awayScore", "score_away", "away_goals", "scoreB"])),
    minute: numOrNull(pick(raw, ["minute", "elapsed", "match_minute", "time_elapsed", "clock"])),
    _raw: { homeName, awayName },
  };
}

async function fetchMatches(url = UPSTREAM) {
  const idx = buildResolver();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.games || data.matches || data.data || data.result || []);
  if (!Array.isArray(arr) || !arr.length) throw new Error("no matches array in upstream payload (check field names)");

  const unresolved = new Set();
  const matches = [];
  for (const raw of arr) {
    const m = normalizeMatch(raw, idx);
    if (!m.group) continue; // group stage only for now (knockout teams are TBD pre-bracket)
    if (!m.home_id || !m.away_id) { unresolved.add(`${m._raw.homeName} / ${m._raw.awayName}`); continue; }
    delete m._raw;
    matches.push(m);
  }
  if (unresolved.size) throw new Error("Unresolved team names — add aliases to data/teams.json:\n  " + [...unresolved].join("\n  "));
  if (matches.length < 72) console.warn(`warning: ${matches.length} group matches resolved (expected 72)`);
  return { source: "worldcup26.ir", fetched_at: new Date().toISOString(), matches };
}

function selftest() {
  const idx = buildResolver();
  const samples = [
    { home_team: "Mexico", away_team: "South Africa", group: "Group A", status: "finished", home_score: 2, away_score: 0 },
    { homeTeam: "Côte d'Ivoire", awayTeam: "Ecuador", group: "E", state: "live", homeScore: 1, awayScore: 1, minute: 55 },
    { home: "Korea Republic", away: "Czechia", group: "A", status: "FT", score_home: 1, score_away: 3 },
    { home_team: "Cape Verde", away_team: "Spain", groupName: "H", status: "scheduled" },
    { home_team: "Turkey", away_team: "Paraguay", group: "D", status: "" },
  ];
  const out = samples.map((s) => normalizeMatch(s, idx));
  const errs = [];
  const expect = [
    ["MEX", "RSA", "A", "completed"], ["CIV", "ECU", "E", "live"],
    ["KOR", "CZE", "A", "completed"], ["CPV", "ESP", "H", "scheduled"],
    ["TUR", "PAR", "D", "scheduled"],
  ];
  out.forEach((m, i) => {
    const [h, a, g, st] = expect[i];
    if (m.home_id !== h) errs.push(`#${i} home ${m.home_id} != ${h}`);
    if (m.away_id !== a) errs.push(`#${i} away ${m.away_id} != ${a}`);
    if (m.group !== g) errs.push(`#${i} group ${m.group} != ${g}`);
    if (m.status !== st) errs.push(`#${i} status ${m.status} != ${st}`);
  });
  if (out[1].minute !== 55) errs.push("live minute not parsed");
  if (errs.length) { console.error("✗ selftest:\n  " + errs.join("\n  ")); process.exit(1); }
  console.log("✓ fetch-matches selftest: alias resolution, tolerant fields, group/status parsing all OK");
}

module.exports = { fetchMatches, normalizeMatch, buildResolver, resolve, parseGroup, mapStatus };

if (require.main === module) {
  if (process.argv.includes("--selftest")) selftest();
  else fetchMatches().then((o) => console.log(JSON.stringify(o, null, 2))).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
