#!/usr/bin/env node
/**
 * fetch-odds.js — Polymarket Gamma → data/probabilities.json (Phase C, defensive-first).
 *
 * Pulls the "World Cup winner" event and maps each team's market to a current implied
 * probability + 24h momentum + volume. The Gamma payload shape is UNVERIFIED from here
 * (egress-blocked), so parsing is tolerant of field-name/encoding variants and the fetch
 * THROWS with a raw sample if too few teams resolve — i.e. it fails loudly on the first
 * real Action run rather than publishing garbage. The dashboard treats this file as
 * optional and degrades to the static pre-tournament odds when it's absent.
 *
 * Known Gamma quirks handled: `outcomes`/`outcomePrices` are JSON-encoded STRINGS; the
 * clean team label is usually `groupItemTitle`; `oneDayPriceChange` is a price delta.
 *
 *   node scripts/fetch-odds.js            # fetch + print probabilities.json
 *   node scripts/fetch-odds.js --selftest # offline: prove parsing/mapping
 *
 * Contract (data/probabilities.json):
 *   { source, event_slug, fetched_at, total_volume_usd,
 *     teams: { ESP: { prob: 0.172, change24h: 0.014, volume: 33600000 }, … } }   // prob in 0..1
 */
const fs = require("fs");
const path = require("path");
const { buildResolver, resolveName } = require("./fetch-matches");

const GAMMA = "https://gamma-api.polymarket.com";
const SLUGS = ["world-cup-winner"]; // primary; a title search is the fallback

const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; };
const num = (x) => { if (x === "" || x == null) return null; const n = Number(x); return Number.isFinite(n) ? n : null; };
const round3 = (x) => Math.round(x * 1000) / 1000;
function asArray(x) {                       // outcomes/outcomePrices come back as JSON strings
  if (Array.isArray(x)) return x;
  if (typeof x === "string") { try { const a = JSON.parse(x); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  return [];
}
async function fetchJson(url) { const r = await fetch(url, { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return r.json(); }

function teamNameOf(m) {
  let name = pick(m, ["groupItemTitle", "group_item_title", "groupTitle", "title"]);
  if (!name) { const q = pick(m, ["question"]); if (q) { const mm = /(?:will\s+)?(.+?)\s+win\b/i.exec(q); name = mm ? mm[1] : q; } }
  return name;
}
function probOf(m) {
  const outs = asArray(pick(m, ["outcomes"])).map((s) => String(s).toLowerCase());
  const prices = asArray(pick(m, ["outcomePrices", "outcome_prices"])).map(Number);
  let yi = outs.indexOf("yes"); if (yi < 0) yi = 0;
  let p = prices.length > yi ? prices[yi] : null;
  if (p == null) p = num(pick(m, ["lastTradePrice", "bestAsk", "price"]));
  return (p != null && p >= 0 && p <= 1) ? p : null;
}
function normalizeMarkets(markets, idx) {
  const teams = {}; const unresolved = [];
  for (const m of markets || []) {
    if (pick(m, ["closed"]) === true) continue;
    const name = teamNameOf(m), id = resolveName(idx, name), p = probOf(m);
    if (!id) { if (name) unresolved.push(String(name)); continue; }
    if (p == null) continue;
    const change = num(pick(m, ["oneDayPriceChange", "one_day_price_change", "priceChange24h", "price_change_24h"]));
    const vol = num(pick(m, ["volumeNum", "volume", "volume24hr", "volumeClob"]));
    const row = { prob: round3(p), change24h: change != null ? round3(change) : null, volume: vol != null ? Math.round(vol) : null };
    if (!teams[id] || (row.volume || 0) > (teams[id].volume || 0)) teams[id] = row; // keep the deepest market on dup
  }
  return { teams, unresolved };
}

async function fetchOdds() {
  const idx = buildResolver();
  let event = null, used = null;
  for (const slug of SLUGS) {
    try {
      const evs = await fetchJson(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`);
      const e = Array.isArray(evs) ? evs[0] : (evs && evs.events ? evs.events[0] : evs);
      if (e && Array.isArray(e.markets) && e.markets.length) { event = e; used = e.slug || slug; break; }
    } catch (e) { /* try next */ }
  }
  if (!event) { // fallback: search open events by title
    try {
      const evs = await fetchJson(`${GAMMA}/events?closed=false&limit=300`);
      const e = (Array.isArray(evs) ? evs : []).find((x) => /world cup.*winner/i.test(x.title || "") && Array.isArray(x.markets) && x.markets.length > 10);
      if (e) { event = e; used = e.slug; }
    } catch (e) { /* fall through */ }
  }
  if (!event) throw new Error("could not locate the World Cup winner event on Gamma (slug + title search both failed)");

  const { teams, unresolved } = normalizeMarkets(event.markets, idx);
  const n = Object.keys(teams).length;
  if (n < 20) throw new Error(
    `only ${n} teams resolved from ${(event.markets || []).length} markets — likely a schema change.\n` +
    `unresolved sample: ${unresolved.slice(0, 8).join(", ")}\n` +
    `first market: ${JSON.stringify((event.markets || [])[0]).slice(0, 600)}`);
  if (n < 40) console.warn(`warning: only ${n} team markets resolved (expected ~48)`);
  return {
    source: "polymarket", event_slug: used, fetched_at: new Date().toISOString(),
    total_volume_usd: num(pick(event, ["volume", "volumeNum"])),
    teams,
  };
}

function selftest() {
  const idx = buildResolver();
  const markets = [
    { groupItemTitle: "Spain", outcomes: '["Yes","No"]', outcomePrices: '["0.172","0.828"]', oneDayPriceChange: 0.014, volume: 33600000 },
    { groupItemTitle: "France", outcomes: ["Yes", "No"], outcomePrices: [0.161, 0.839], oneDayPriceChange: -0.009, volumeNum: 40900000 },
    { question: "Will Czech Republic win the 2026 World Cup?", outcomes: '["Yes","No"]', outcomePrices: '["0.004","0.996"]', volume: 50000 }, // alias resolves CZE
    { groupItemTitle: "Turkey", outcomes: '["Yes","No"]', outcomePrices: '["0.01","0.99"]' }, // → TUR, no change/vol
    { groupItemTitle: "Field / Another team", outcomes: '["Yes","No"]', outcomePrices: '["0.02","0.98"]' }, // unresolved → skipped
    { groupItemTitle: "Spain", outcomes: '["Yes","No"]', outcomePrices: '["0.17","0.83"]', volume: 10 }, // dup, lower vol → ignored
  ];
  const { teams, unresolved } = normalizeMarkets(markets, idx);
  const errs = [];
  if (teams.ESP?.prob !== 0.172) errs.push(`ESP prob ${teams.ESP?.prob} != 0.172 (deepest market kept)`);
  if (teams.ESP?.change24h !== 0.014) errs.push(`ESP change ${teams.ESP?.change24h} != 0.014`);
  if (teams.FRA?.prob !== 0.161 || teams.FRA?.change24h !== -0.009) errs.push(`FRA mapping wrong: ${JSON.stringify(teams.FRA)}`);
  if (teams.CZE?.prob !== 0.004) errs.push(`CZE (via question/alias) ${JSON.stringify(teams.CZE)}`);
  if (teams.TUR?.prob !== 0.01 || teams.TUR?.change24h !== null) errs.push(`TUR mapping wrong: ${JSON.stringify(teams.TUR)}`);
  if (!unresolved.some((u) => /field/i.test(u))) errs.push("expected the non-team market to be unresolved/skipped");
  if (errs.length) { console.error("✗ fetch-odds selftest:\n  " + errs.join("\n  ")); process.exit(1); }
  console.log("✓ fetch-odds selftest: JSON-string outcomes, Yes-price, alias/question resolve, dup-by-volume, skip non-team — all OK");
}

module.exports = { fetchOdds, normalizeMarkets, teamNameOf, probOf };

if (require.main === module) {
  if (process.argv.includes("--selftest")) selftest();
  else fetchOdds().then((o) => console.log(JSON.stringify(o, null, 2))).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
}
