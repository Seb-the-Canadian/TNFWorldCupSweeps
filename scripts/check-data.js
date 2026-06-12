#!/usr/bin/env node
/**
 * check-data.js — guards the Phase A canonical data.
 *
 * index.html's inline TEAMS / POOL are the source of truth. This asserts that
 * data/teams.json and data/pool.json stay in sync with them, and that the
 * team-identity model is internally consistent (unique IDs, valid references,
 * complete groups). Exits non-zero on any mismatch so it can gate CI / commits.
 *
 *   node scripts/check-data.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const teamsJson = JSON.parse(fs.readFileSync(path.join(root, "data/teams.json"), "utf8"));
const poolJson = JSON.parse(fs.readFileSync(path.join(root, "data/pool.json"), "utf8"));

// Extract the inline TEAMS/POOL by evaluating the page script against DOM stubs.
function extractInline() {
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const el = () => ({
    style: { setProperty() {} }, value: "",
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, setAttribute() {}, querySelectorAll: () => [],
    set innerHTML(_) {},
  });
  global.document = {
    getElementById: el, querySelectorAll: () => [],
    documentElement: { style: { setProperty() {} } }, addEventListener() {}, hidden: true,
  };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  // The page's init schedules a poll and fetches live data; neutralise both so this
  // check evaluates the data definitions without keeping Node's event loop alive.
  global.setInterval = () => 0;
  global.clearInterval = () => {};
  global.fetch = async () => ({ ok: false });
  eval(script + ";globalThis.__TEAMS=TEAMS;globalThis.__POOL=POOL;");
  return { TEAMS: globalThis.__TEAMS, POOL: globalThis.__POOL };
}

const { TEAMS, POOL } = extractInline();
const errors = [];
const E = (m) => errors.push(m);

// ── Identity integrity ──────────────────────────────────────────────────────
const ids = Object.keys(TEAMS);
if (ids.length !== 48) E(`TEAMS has ${ids.length} entries, expected 48`);
if (new Set(ids).size !== ids.length) E("duplicate team IDs in TEAMS");

const GROUP_LETTERS = "ABCDEFGHIJKL".split("");
GROUP_LETTERS.forEach((g) => {
  const n = ids.filter((id) => TEAMS[id].group === g).length;
  if (n !== 4) E(`group ${g} has ${n} teams, expected 4`);
});

if (POOL.length !== 24) E(`POOL has ${POOL.length} participants, expected 24`);
if (new Set(POOL.map((p) => p.id)).size !== POOL.length) E("duplicate participant ids");
if (new Set(POOL.map((p) => p.name)).size !== POOL.length) E("duplicate participant names");

const ownedIds = POOL.flatMap((p) => p.teams);
if (ownedIds.length !== 48) E(`participants own ${ownedIds.length} team slots, expected 48`);
if (new Set(ownedIds).size !== 48) E("a team is owned by more than one participant");
ownedIds.forEach((id) => { if (!TEAMS[id]) E(`participant references unknown team ID "${id}"`); });

// ── Inline vs data/teams.json ───────────────────────────────────────────────
const jt = teamsJson.teams;
ids.forEach((id) => {
  if (!jt[id]) { E(`teams.json missing "${id}"`); return; }
  if (jt[id].display !== TEAMS[id].name) E(`teams.json[${id}].display "${jt[id].display}" != inline "${TEAMS[id].name}"`);
  if (jt[id].group !== TEAMS[id].group) E(`teams.json[${id}].group "${jt[id].group}" != inline "${TEAMS[id].group}"`);
  const a = jt[id].aliases || {};
  if (!Array.isArray(a.worldcup26ir) || !Array.isArray(a.polymarket)) E(`teams.json[${id}] missing alias arrays`);
});
Object.keys(jt).forEach((id) => { if (!TEAMS[id]) E(`teams.json has extra team "${id}" not in inline TEAMS`); });

// ── Inline vs data/pool.json ────────────────────────────────────────────────
const jp = poolJson.participants;
if (jp.length !== POOL.length) E(`pool.json has ${jp.length} participants, inline has ${POOL.length}`);
POOL.forEach((p) => {
  const m = jp.find((x) => x.id === p.id);
  if (!m) { E(`pool.json missing participant "${p.id}"`); return; }
  if (m.display !== p.name) E(`pool.json[${p.id}].display "${m.display}" != inline name "${p.name}"`);
  if (m.color !== p.color) E(`pool.json[${p.id}].color mismatch`);
  if (m.bg !== p.bg) E(`pool.json[${p.id}].bg mismatch`);
  if (JSON.stringify(m.teams) !== JSON.stringify(p.teams)) E(`pool.json[${p.id}].teams ${JSON.stringify(m.teams)} != inline ${JSON.stringify(p.teams)}`);
});

if (errors.length) {
  console.error(`✗ check-data: ${errors.length} issue(s)\n  - ` + errors.join("\n  - "));
  process.exit(1);
}
console.log(`✓ check-data: 48 teams, 24 participants — inline TEAMS/POOL match data/teams.json + data/pool.json`);
process.exit(0); // the evaluated page script may leave timers/promises pending; exit cleanly
