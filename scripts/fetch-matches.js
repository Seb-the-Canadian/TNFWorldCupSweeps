#!/usr/bin/env node
/**
 * fetch-matches.js — worldcup26.ir → data/matches.json (Phase B).
 *
 * Real upstream schema, confirmed from the API's open-source repo
 * (github.com/rezarahiminia/worldcup2026):
 *
 *   GET /get/games  → [{ id, home_team_id, away_team_id,
 *                        home_team_name_en, away_team_name_en,
 *                        group ("A".."L" | "R32"…), matchday, type ("group"|"r32"…),
 *                        local_date ("MM/DD/YYYY HH:mm", VENUE-local), finished (bool/"TRUE"),
 *                        time_elapsed ("notstarted" | minutes), home_score, away_score }]
 *   GET /get/teams  → [{ id, name_en, name_fa, fifa_code ("ARG"), groups ("A".."L"), flag }]
 *
 * Join: each game's home_team_id/away_team_id → upstream team's `fifa_code`, which IS our
 * canonical pool ID. Falls back to resolving name_en via data/teams.json aliases. Emits the
 * matches.json contract the dashboard reads (keyed by home_id/away_id/group, order-independent).
 *
 * On any unresolved team or empty payload it THROWS with a raw sample, so a schema drift
 * fails loudly (the Action keeps last-good data) and the log shows exactly what to fix.
 *
 *   node scripts/fetch-matches.js            # fetch + print contract JSON
 *   node scripts/fetch-matches.js --selftest # offline: prove resolution/mapping
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GAMES_URL = "https://worldcup26.ir/get/games";
const TEAMS_URL = "https://worldcup26.ir/get/teams";

const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const numOrNull = (x) => { if (x === "" || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };

// name / alias / canonical-id → canonical FIFA ID (fallback resolver)
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
const resolveName = (idx, name) => (name == null ? null : idx.get(norm(name)) || null);

// upstream numeric team id (as string) → canonical FIFA ID, via the feed's own fifa_code
function buildIdMap(teamsArr) {
  const map = new Map();
  for (const t of teamsArr || []) {
    const id = pick(t, ["id", "team_id", "_id"]);
    const code = pick(t, ["fifa_code", "code", "fifaCode"]);
    if (id != null && code) map.set(String(id), String(code).toUpperCase());
  }
  return map;
}

function parseGroup(g) {
  if (g == null) return null;
  const c = String(g).replace(/group/ig, "").replace(/[^a-lA-L]/g, "").toUpperCase();
  return c ? c[0] : null;
}

// status from `finished` (wins) then `time_elapsed` (which can be "notstarted" | minutes | "finished")
function mapStatus(raw) {
  const finished = pick(raw, ["finished", "is_finished", "completed"]);
  const te = String(pick(raw, ["time_elapsed", "status", "state", "match_status"]) ?? "").trim().toLowerCase();
  if (/^(true|1|yes)$/i.test(String(finished)) || /(finish|full|ft|ended|aet|pen)/.test(te)) return "completed";
  if (te === "" || /^(notstarted|not ?started|ns|scheduled|upcoming|tbd|0)$/.test(te)) return "scheduled";
  return "live";
}
const parseMinute = (te) => { const m = /(\d{1,3})/.exec(String(te == null ? "" : te)); return m ? Number(m[1]) : null; };

function normalizeMatch(raw, ctx) {
  const homeName = pick(raw, ["home_team_name_en", "home_team_name", "home_team", "homeTeam", "home"]);
  const awayName = pick(raw, ["away_team_name_en", "away_team_name", "away_team", "awayTeam", "away"]);
  const homeUid = pick(raw, ["home_team_id", "homeTeamId", "home_id", "team1_id"]);
  const awayUid = pick(raw, ["away_team_id", "awayTeamId", "away_id", "team2_id"]);
  const join = (uid, name) => (uid != null && ctx.byId.get(String(uid))) || resolveName(ctx.idx, name);
  return {
    group: parseGroup(pick(raw, ["group", "group_name", "groupName"])),
    matchday: numOrNull(pick(raw, ["matchday", "round", "match_day", "week"])),
    match_number: numOrNull(pick(raw, ["id", "match_number", "number", "matchId"])),
    kickoff_utc: null,                                              // local_date is venue-local; the UI uses our own ET schedule for times
    kickoff_local: pick(raw, ["local_date", "date", "datetime", "kickoff"]) || null,
    home_id: join(homeUid, homeName),
    away_id: join(awayUid, awayName),
    status: mapStatus(raw),
    home_score: numOrNull(pick(raw, ["home_score", "homeScore", "score_home"])),
    away_score: numOrNull(pick(raw, ["away_score", "awayScore", "score_away"])),
    minute: parseMinute(pick(raw, ["time_elapsed", "minute", "elapsed"])),
    _raw: { homeName, awayName, homeUid, awayUid },
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status} for ${url}`);
  return res.json();
}
const toArray = (data, keys) => Array.isArray(data) ? data : (keys.map((k) => data && data[k]).find(Array.isArray) || []);

async function fetchMatches(gamesUrl = GAMES_URL, teamsUrl = TEAMS_URL) {
  const idx = buildResolver();
  const byId = buildIdMap(toArray(await fetchJson(teamsUrl), ["teams", "data", "result"]));
  const data = await fetchJson(gamesUrl);
  const arr = toArray(data, ["games", "matches", "data", "result"]);
  if (!arr.length) throw new Error("no games array in payload; top-level keys: " + Object.keys(data || {}).join(", "));

  const ctx = { idx, byId };
  const unresolved = [];
  const matches = [];
  for (const raw of arr) {
    const rtype = String(pick(raw, ["type", "stage", "round_type"]) ?? "").toLowerCase();
    if (rtype && rtype !== "group") continue;   // skip knockouts (team_id:0 / TBD before the bracket)
    const m = normalizeMatch(raw, ctx);
    if (!m.group) continue;                      // belt-and-suspenders for any untyped non-group row
    if (!m.home_id || !m.away_id) { unresolved.push(JSON.stringify(m._raw)); continue; }
    delete m._raw;
    matches.push(m);
  }
  if (unresolved.length) {
    throw new Error(
      `Unresolved teams (${unresolved.length}); upstream id→fifa map size=${byId.size}.\n  ` +
      unresolved.slice(0, 5).join("\n  ") +
      `\nFirst raw game: ` + JSON.stringify(arr[0]).slice(0, 600));
  }
  if (!matches.length) throw new Error("0 group matches after filtering; first raw game: " + JSON.stringify(arr[0]).slice(0, 600));
  if (matches.length < 72) console.warn(`warning: ${matches.length} group matches resolved (expected 72)`);
  return { source: "worldcup26.ir", fetched_at: new Date().toISOString(), matches };
}

function selftest() {
  const idx = buildResolver();
  const byId = new Map([["1", "MEX"], ["2", "RSA"], ["3", "CIV"], ["4", "ECU"]]); // upstream id → fifa_code
  const ctx = { idx, byId };
  const samples = [
    { id: 1, home_team_id: 1, away_team_id: 2, home_team_name_en: "Mexico", away_team_name_en: "South Africa", group: "A", type: "group", finished: "TRUE", home_score: 2, away_score: 0, time_elapsed: "90", matchday: 1, local_date: "06/11/2026 13:00" },
    { id: 2, home_team_id: 3, away_team_id: 4, home_team_name_en: "Côte d'Ivoire", away_team_name_en: "Ecuador", group: "E", finished: false, time_elapsed: "55", home_score: 1, away_score: 1 },
    { id: 3, home_team_id: 999, away_team_id: 998, home_team_name_en: "Korea Republic", away_team_name_en: "Czechia", group: "A", finished: "TRUE", time_elapsed: "FT", home_score: 1, away_score: 3 }, // id miss → name fallback
    { id: 4, home_team_id: 0, away_team_id: 0, home_team_name_en: "Cape Verde", away_team_name_en: "Spain", group: "H", finished: false, time_elapsed: "notstarted" },
    { id: 5, home_team_id: 0, away_team_id: 0, home_team_name_en: "Turkey", away_team_name_en: "Paraguay", group: "D", finished: false, time_elapsed: "" },
    { id: 6, home_team_id: 0, away_team_id: 0, home_team_name_en: "England", away_team_name_en: "Croatia", group: "L", finished: false, time_elapsed: "finished" }, // completed via time_elapsed (no finished flag)
  ];
  const out = samples.map((s) => normalizeMatch(s, ctx));
  const expect = [
    ["MEX", "RSA", "A", "completed", 90], ["CIV", "ECU", "E", "live", 55],
    ["KOR", "CZE", "A", "completed", null], ["CPV", "ESP", "H", "scheduled", null],
    ["TUR", "PAR", "D", "scheduled", null], ["ENG", "CRO", "L", "completed", null],
  ];
  const errs = [];
  out.forEach((m, i) => {
    const [h, a, g, st, min] = expect[i];
    if (m.home_id !== h) errs.push(`#${i} home ${m.home_id} != ${h}`);
    if (m.away_id !== a) errs.push(`#${i} away ${m.away_id} != ${a}`);
    if (m.group !== g) errs.push(`#${i} group ${m.group} != ${g}`);
    if (m.status !== st) errs.push(`#${i} status ${m.status} != ${st}`);
    if (m.minute !== min) errs.push(`#${i} minute ${m.minute} != ${min}`);
  });
  // knockout rows (type !== "group", team_id 0) are excluded in fetchMatches' loop by the `type` field
  if (errs.length) { console.error("✗ selftest:\n  " + errs.join("\n  ")); process.exit(1); }
  console.log("✓ fetch-matches selftest: fifa_code id-join + name fallback, status/minute/group/finished parsing all OK");
}

module.exports = { fetchMatches, normalizeMatch, buildResolver, buildIdMap, resolveName, parseGroup, mapStatus };

if (require.main === module) {
  if (process.argv.includes("--selftest")) selftest();
  else fetchMatches().then((o) => console.log(JSON.stringify(o, null, 2))).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
