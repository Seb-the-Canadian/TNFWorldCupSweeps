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
const STADIUMS_URL = "https://worldcup26.ir/get/stadiums";

const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// ── Kickoff instants ────────────────────────────────────────────────────────────
// The feed's local_date is VENUE-local with no zone. The 16 host cities are fixed, so we
// map stadium → IANA zone by city/name keywords and compute a true UTC instant. If a
// stadium can't be mapped, kickoff_utc stays null and the dashboard falls back to its
// static times — failure degrades, never breaks.
const CITY_TZ = [
  [/mexicocity|azteca/, "America/Mexico_City"], [/guadalajara|akron|zapopan/, "America/Mexico_City"],
  [/monterrey|bbva|guadalupe/, "America/Monterrey"],
  [/atlanta|mercedes/, "America/New_York"], [/newyork|newjersey|eastrutherford|metlife/, "America/New_York"],
  [/boston|foxboro|gillette/, "America/New_York"], [/philadelphia|lincolnfinancial/, "America/New_York"],
  [/miami|hardrock|gardens/, "America/New_York"], [/toronto|bmo/, "America/Toronto"],
  [/houston|nrg/, "America/Chicago"], [/dallas|arlington|attstadium/, "America/Chicago"],   // "att" alone would match inside "seattle"
  [/kansascity|arrowhead/, "America/Chicago"],
  [/losangeles|inglewood|sofi/, "America/Los_Angeles"], [/sanfrancisco|santaclara|levi/, "America/Los_Angeles"],
  [/seattle|lumen/, "America/Los_Angeles"], [/vancouver|bcplace/, "America/Vancouver"],
];
function stadiumTz(stadium) {
  const key = norm([pick(stadium, ["city", "city_en", "cityName", "location"]), pick(stadium, ["name", "name_en", "stadium", "title"])].filter(Boolean).join(" "));
  const hit = CITY_TZ.find(([re]) => re.test(key));
  return hit ? hit[1] : null;
}
function buildTzMap(stadiumsArr) {
  const map = new Map();
  for (const s of stadiumsArr || []) {
    const id = pick(s, ["id", "stadium_id", "_id"]);
    const tz = stadiumTz(s);
    if (id != null && tz) map.set(String(id), tz);
  }
  return map;
}
// "MM/DD/YYYY HH:mm" in an IANA zone → epoch ms (two-pass Intl offset solve, no deps).
function zonedToUtc(localStr, tz) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{1,2}):(\d{2})/.exec(String(localStr || "").trim());
  if (!m || !tz) return null;
  const [, MM, DD, YYYY, hh, mm] = m.map(Number);
  const naive = Date.UTC(YYYY, MM - 1, DD, hh, mm);
  let t = naive;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hour12: false });
  for (let i = 0; i < 2; i++) {
    const g = {}; fmt.formatToParts(new Date(t)).forEach((p) => g[p.type] = p.value);
    const asUtc = Date.UTC(+g.year, +g.month - 1, +g.day, g.hour === "24" ? 0 : +g.hour, +g.minute);
    t += naive - asUtc;
  }
  return t;
}
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

// status from `finished` (wins) then `time_elapsed` (which can be "notstarted" | minutes | "finished").
// "live" must be EXPLICIT (minutes, HT, live markers) — never the fallthrough. A postponed/
// cancelled/unknown state defaulting to "live" would turn into a permanent every-5-min
// heartbeat (refresh.js's anyLive) and a phantom LIVE badge in the UI.
function mapStatus(raw) {
  const finished = pick(raw, ["finished", "is_finished", "completed"]);
  const te = String(pick(raw, ["time_elapsed", "status", "state", "match_status"]) ?? "").trim().toLowerCase();
  if (/^(true|1|yes)$/i.test(String(finished)) || /(finish|full|ft|ended|aet|pen)/.test(te)) return "completed";
  if (te === "" || /^(notstarted|not ?started|ns|scheduled|upcoming|tbd|0)$/.test(te)) return "scheduled";
  if (/^\d{1,3}(\+\d{1,2})?'?$/.test(te) || /^(ht|half ?time)$/.test(te) || /(live|playing|in.?progress|1st|2nd|break|paused)/.test(te)) return "live";
  console.warn(`warning: unknown match status "${te}" — treating as scheduled`);
  return "scheduled";
}
const parseMinute = (te) => { const m = /(\d{1,3})/.exec(String(te == null ? "" : te)); return m ? Number(m[1]) : null; };

function normalizeMatch(raw, ctx) {
  const homeName = pick(raw, ["home_team_name_en", "home_team_name", "home_team", "homeTeam", "home"]);
  const awayName = pick(raw, ["away_team_name_en", "away_team_name", "away_team", "awayTeam", "away"]);
  const homeUid = pick(raw, ["home_team_id", "homeTeamId", "home_id", "team1_id"]);
  const awayUid = pick(raw, ["away_team_id", "awayTeamId", "away_id", "team2_id"]);
  // Trust the feed's fifa_code only if it maps to one of OUR canonical IDs; otherwise fall
  // back to name resolution (so an ISO-style code like "ZAF" can't slip through as a
  // truthy-but-unknown id that silently drops the match downstream).
  const join = (uid, name) => {
    const code = uid != null ? ctx.byId.get(String(uid)) : null;
    return (code && ctx.idx.get(norm(code))) || resolveName(ctx.idx, name);
  };
  const kickoffLocal = pick(raw, ["local_date", "date", "datetime", "kickoff"]) || null;
  const tz = ctx.tzMap && ctx.tzMap.get(String(pick(raw, ["stadium_id", "stadiumId", "stadium"])));
  const kickoffMs = zonedToUtc(kickoffLocal, tz);
  return {
    group: parseGroup(pick(raw, ["group", "group_name", "groupName"])),
    matchday: numOrNull(pick(raw, ["matchday", "round", "match_day", "week"])),
    match_number: numOrNull(pick(raw, ["id", "match_number", "number", "matchId"])),
    round: String(pick(raw, ["type", "stage", "round_type"]) ?? "").toLowerCase() || null, // "group" | "r32" | "r16" | "qf" | "sf" | "third" | "final"
    kickoff_utc: kickoffMs != null ? new Date(kickoffMs).toISOString() : null, // true instant (stadium-tz resolved); null if unmappable
    kickoff_local: kickoffLocal,
    home_id: join(homeUid, homeName),
    away_id: join(awayUid, awayName),
    status: mapStatus(raw),
    home_score: numOrNull(pick(raw, ["home_score", "homeScore", "score_home"])),
    away_score: numOrNull(pick(raw, ["away_score", "awayScore", "score_away"])),
    // Penalty shoot-out scores (knockouts decided after a level ET): null when absent. The UI
    // uses these to pick the winner when home_score === away_score.
    home_pen: numOrNull(pick(raw, ["home_penalty", "home_pen", "penalty_home", "home_penalties", "home_pso"])),
    away_pen: numOrNull(pick(raw, ["away_penalty", "away_pen", "penalty_away", "away_penalties", "away_pso"])),
    minute: parseMinute(pick(raw, ["time_elapsed", "minute", "elapsed"])),
    _raw: { homeName, awayName, homeUid, awayUid },
  };
}

async function fetchJson(url) {
  // Bound every upstream call so a hung endpoint can't stall the Action until the 6h job
  // timeout — a timeout surfaces as a normal fetch error the callers already handle.
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status} for ${url}`);
  return res.json();
}
const toArray = (data, keys) => Array.isArray(data) ? data : (keys.map((k) => data && data[k]).find(Array.isArray) || []);

async function fetchMatches(gamesUrl = GAMES_URL, teamsUrl = TEAMS_URL, stadiumsUrl = STADIUMS_URL) {
  const idx = buildResolver();
  const byId = buildIdMap(toArray(await fetchJson(teamsUrl), ["teams", "data", "result"]));
  // Stadium→tz map is best-effort: if the endpoint or mapping fails, kickoff_utc is null
  // for affected matches and the dashboard falls back to its static times.
  let tzMap = new Map();
  try { tzMap = buildTzMap(toArray(await fetchJson(stadiumsUrl), ["stadiums", "data", "result"])); }
  catch (e) { console.warn("warning: stadiums fetch failed (" + e.message + ") — kickoff_utc will be null"); }
  const data = await fetchJson(gamesUrl);
  const arr = toArray(data, ["games", "matches", "data", "result"]);
  if (!arr.length) throw new Error("no games array in payload; top-level keys: " + Object.keys(data || {}).join(", "));

  const ctx = { idx, byId, tzMap };
  const unresolved = [];
  const matches = [];
  const knockouts = [];
  for (const raw of arr) {
    const m = normalizeMatch(raw, ctx);
    if (m.round && m.round !== "group") {        // knockout: teams are TBD (id 0) until the draw — keep with nulls
      delete m._raw;
      knockouts.push(m);
      continue;
    }
    if (!m.group) continue;                      // skip any untyped non-group row
    if (!m.home_id || !m.away_id) { unresolved.push(JSON.stringify(m._raw)); continue; }
    delete m._raw;
    matches.push(m);
  }
  if (unresolved.length) {
    throw new Error(
      `Unresolved GROUP teams (${unresolved.length}); upstream id→fifa map size=${byId.size}.\n  ` +
      unresolved.slice(0, 5).join("\n  ") +
      `\nFirst raw game: ` + JSON.stringify(arr[0]).slice(0, 600));
  }
  if (!matches.length) throw new Error("0 group matches after filtering; first raw game: " + JSON.stringify(arr[0]).slice(0, 600));
  if (matches.length < 72) console.warn(`warning: ${matches.length} group matches resolved (expected 72)`);
  return { source: "worldcup26.ir", fetched_at: new Date().toISOString(), matches, knockouts };
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
  // knockout rows: normalized with a round + TBD (null) teams; fetchMatches routes them to `knockouts`
  const ko = normalizeMatch({ id: 80, home_team_id: 0, away_team_id: 0, group: "", type: "r32", finished: false, time_elapsed: "notstarted" }, ctx);
  if (ko.round !== "r32") errs.push(`knockout round ${ko.round} != r32`);
  if (ko.home_id !== null || ko.away_id !== null) errs.push("knockout teams should be null (TBD)");
  if (ko.status !== "scheduled") errs.push(`knockout status ${ko.status} != scheduled`);
  // unknown/postponed statuses must NOT become "live" (would create a permanent heartbeat)
  const post = normalizeMatch({ id: 81, home_team_id: 1, away_team_id: 2, group: "A", finished: false, time_elapsed: "postponed" }, ctx);
  if (post.status !== "scheduled") errs.push(`postponed status ${post.status} != scheduled`);
  // stoppage-time minutes still count as live
  const stop = normalizeMatch({ id: 82, home_team_id: 1, away_team_id: 2, group: "A", finished: false, time_elapsed: "45+2" }, ctx);
  if (stop.status !== "live" || stop.minute !== 45) errs.push(`45+2 → ${stop.status}/${stop.minute}, expected live/45`);
  // a non-canonical fifa_code from the feed must fall back to name resolution, not pass through
  const badCode = normalizeMatch({ id: 83, home_team_id: 7, away_team_id: 2, home_team_name_en: "South Africa", away_team_name_en: "Mexico", group: "A", finished: false, time_elapsed: "" },
    { idx, byId: new Map([["7", "ZAF"], ["2", "MEX"]]) });
  if (badCode.home_id !== "RSA") errs.push(`bad fifa_code passthrough: home_id ${badCode.home_id} != RSA (name fallback)`);
  // penalty shoot-out scores are carried when present
  const pens = normalizeMatch({ id: 84, home_team_id: 1, away_team_id: 2, group: "", type: "r16", finished: "TRUE", time_elapsed: "pens", home_score: 1, away_score: 1, home_penalty: 4, away_penalty: 2 }, ctx);
  if (pens.status !== "completed" || pens.home_pen !== 4 || pens.away_pen !== 2) errs.push(`pens → ${pens.status}/${pens.home_pen}-${pens.away_pen}, expected completed/4-2`);
  // kickoff instants: venue-local → UTC via stadium tz (DST-correct; Mexico has no DST since 2022)
  if (zonedToUtc("06/13/2026 21:00", "America/Vancouver") !== Date.parse("2026-06-14T04:00:00Z")) errs.push("zonedToUtc Vancouver 9PM PDT wrong");
  if (zonedToUtc("06/11/2026 13:00", "America/Mexico_City") !== Date.parse("2026-06-11T19:00:00Z")) errs.push("zonedToUtc Mexico City (no DST) wrong");
  if (stadiumTz({ city: "Seattle", name: "Lumen Field" }) !== "America/Los_Angeles") errs.push("stadiumTz Seattle wrong");
  if (stadiumTz({ city: "East Rutherford", name: "MetLife Stadium" }) !== "America/New_York") errs.push("stadiumTz MetLife wrong");
  const withKick = normalizeMatch({ id: 85, home_team_id: 1, away_team_id: 2, group: "A", finished: false, time_elapsed: "", local_date: "06/13/2026 21:00", stadium_id: "9" }, { idx, byId, tzMap: new Map([["9", "America/Vancouver"]]) });
  if (withKick.kickoff_utc !== "2026-06-14T04:00:00.000Z") errs.push(`kickoff_utc ${withKick.kickoff_utc} != 2026-06-14T04:00:00.000Z`);
  if (errs.length) { console.error("✗ selftest:\n  " + errs.join("\n  ")); process.exit(1); }
  console.log("✓ fetch-matches selftest: id-join + code validation, name fallback, status/minute/pens, knockout routing all OK");
}

module.exports = { fetchMatches, normalizeMatch, buildResolver, buildIdMap, resolveName, parseGroup, mapStatus, zonedToUtc, stadiumTz, buildTzMap };

if (require.main === module) {
  if (process.argv.includes("--selftest")) selftest();
  else fetchMatches().then((o) => console.log(JSON.stringify(o, null, 2))).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
