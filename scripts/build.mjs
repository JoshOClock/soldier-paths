// Build: read data/*.csv, validate, compute each soldier's daily track and the
// "close by" episodes between soldiers, and write JSON for the static site.
// No dependencies. Run: node scripts/build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { parseDate, dayIndex, dayToIso, DAY0 } from './lib/dates.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'site', 'data');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function load(name, required, optional = false) {
  const file = path.join(DATA, name + '.csv');
  if (!fs.existsSync(file)) { if (!optional) err(`missing data/${name}.csv`); return []; }
  const { header, rows } = parseCsv(fs.readFileSync(file, 'utf8'));
  for (const col of required) if (!header.includes(col)) err(`data/${name}.csv: missing column "${col}"`);
  rows.forEach((r, i) => { r._where = `data/${name}.csv row ${i + 2}`; });
  return rows;
}

function index(rows, key, name) {
  const map = new Map();
  for (const r of rows) {
    const id = r[key];
    if (!id) { err(`${r._where}: empty ${key}`); continue; }
    if (map.has(id)) err(`${r._where}: duplicate ${key} "${id}" in ${name}`);
    map.set(id, r);
  }
  return map;
}

// ---------- load ----------
const soldiers = load('soldiers', ['soldier_id', 'display_name', 'birth_date', 'privacy']);
const units = load('units', ['unit_id', 'name', 'kind', 'parent_id']);
const unitParents = load('unit_parents', ['unit_id', 'parent_id', 'date_from', 'date_to', 'source_id']);
const postings = load('postings', ['posting_id', 'soldier_id', 'unit_id', 'date_from', 'date_to', 'source_id', 'confidence', 'status']);
const unitLocs = load('unit_locations', ['location_id', 'unit_id', 'date_from', 'date_to', 'place_id', 'source_id', 'confidence', 'status']);
const events = load('events', ['event_id', 'soldier_id', 'kind', 'date', 'place_id', 'source_id', 'confidence', 'status']);
const places = load('places', ['place_id', 'name', 'lon', 'lat', 'precision_km']);
const sources = load('sources', ['source_id', 'kind', 'title']);
const quotes = load('quotes', ['quote_id', 'event_id', 'source_id', 'text'], true);
const notes = load('closeby_notes', ['note_id', 'soldier_a', 'events_a', 'soldier_b', 'events_b', 'title', 'text'], true);
const landmarks = load('landmarks', ['landmark_id', 'name', 'kind', 'lon', 'lat'], true);
const glossary = load('glossary', ['term', 'note'], true);
const sheets = load('map_sheets', ['sheet_id', 'name', 'published', 'west', 'south', 'east', 'north'], true);
const conflicts = load('conflicts', ['conflict_id', 'soldier_id', 'fact_a', 'fact_b', 'note'], true);

const S = index(soldiers, 'soldier_id', 'soldiers');
const U = index(units, 'unit_id', 'units');
const P = index(places, 'place_id', 'places');
const SRC = index(sources, 'source_id', 'sources');
index(postings, 'posting_id', 'postings');
index(unitLocs, 'location_id', 'unit_locations');
const E = index(events, 'event_id', 'events');
const PO = new Map(postings.map((p) => [p.posting_id, p]));
index(quotes, 'quote_id', 'quotes');

const CONFIDENCE = ['documented', 'inherited', 'inferred', 'family'];
const STATUS = ['ai_draft', 'checked', 'confirmed', 'disputed', 'family'];

// ---------- validate ----------
for (const p of places) {
  const lon = +p.lon, lat = +p.lat;
  if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) err(`${p._where}: bad coordinates ${p.lon},${p.lat}`);
  if (!(+p.precision_km > 0)) warn(`${p._where}: precision_km missing, using 5`);
}
for (const u of units) if (u.parent_id && !U.has(u.parent_id)) err(`${u._where}: unknown parent_id "${u.parent_id}"`);

function checkRef(r, field, map, what) {
  if (r[field] && !map.has(r[field])) err(`${r._where}: unknown ${what} "${r[field]}"`);
}
function checkFact(r) {
  if (!r.source_id) err(`${r._where}: every fact needs a source_id`);
  checkRef(r, 'source_id', SRC, 'source');
  if (r.confidence && !CONFIDENCE.includes(r.confidence)) err(`${r._where}: confidence must be one of ${CONFIDENCE.join(', ')}`);
  if (r.status && !STATUS.includes(r.status)) err(`${r._where}: status must be one of ${STATUS.join(', ')}`);
}
function range(r, from, to) {
  const a = parseDate(r[from]);
  if (!a) { err(`${r._where}: can't read date "${r[from]}"`); return null; }
  if (!to) return a;
  if (!r[to]) return { lo: a.lo, hi: null, text: r[from] + ' on' };
  const b = parseDate(r[to]);
  if (!b) { err(`${r._where}: can't read date "${r[to]}"`); return null; }
  if (b.hi < a.lo) err(`${r._where}: ends before it starts`);
  return { lo: a.lo, hi: b.hi, text: `${r[from]} to ${r[to]}` };
}

for (const s of soldiers) {
  if (s.birth_date && !parseDate(s.birth_date)) err(`${s._where}: can't read birth_date "${s.birth_date}"`);
  checkRef(s, 'birth_place_id', P, 'place');
}
for (const r of postings) { checkRef(r, 'soldier_id', S, 'soldier'); checkRef(r, 'unit_id', U, 'unit'); checkFact(r); r._range = range(r, 'date_from', 'date_to'); }
for (const r of unitLocs) { checkRef(r, 'unit_id', U, 'unit'); checkRef(r, 'place_id', P, 'place'); checkFact(r); r._range = range(r, 'date_from', 'date_to'); }
for (const r of unitParents) { checkRef(r, 'unit_id', U, 'unit'); checkRef(r, 'parent_id', U, 'unit'); checkRef(r, 'source_id', SRC, 'source'); r._range = range(r, 'date_from', 'date_to'); }
for (const r of events) {
  checkRef(r, 'soldier_id', S, 'soldier'); checkRef(r, 'place_id', P, 'place'); checkRef(r, 'unit_id', U, 'unit'); checkFact(r);
  r._range = parseDate(r.date);
  if (!r._range) err(`${r._where}: can't read date "${r.date}"`);
}

for (const q of quotes) { checkRef(q, 'event_id', E, 'event'); checkRef(q, 'source_id', SRC, 'source'); }
for (const n of notes) {
  checkRef(n, 'soldier_a', S, 'soldier'); checkRef(n, 'soldier_b', S, 'soldier');
  for (const id of [...n.events_a.split(';'), ...n.events_b.split(';')].filter(Boolean)) if (!E.has(id)) err(`${n._where}: unknown event "${id}"`);
}
for (const c of conflicts) for (const f of [c.fact_a, c.fact_b]) if (!E.has(f) && !PO.has(f)) err(`${c._where}: unknown fact "${f}"`);

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}

// ---------- tracks ----------
// A soldier's position on a day comes from, in order:
//   1. his own dated event with a place (latest one started on or before that day)
//   2. his unit's location that day, walking up the unit tree
// Each day carries a radius (km) for uncertainty and the source it came from.
const LAST_DAY = dayIndex('1946-12-31');
const UNIT_STEP_KM = { battery: 0.5, company: 0.5, troop: 0.5, regiment: 0, battalion: 0, field_ambulance: 0, brigade: 10, division: 25, corps: 50, army: 100 };

function parentOf(unitId, day) {
  for (const r of unitParents) if (r.unit_id === unitId && r._range && r._range.lo <= day && (r._range.hi == null || day <= r._range.hi)) return r.parent_id;
  return U.get(unitId)?.parent_id || '';
}
function unitPos(unitId, day) {
  let id = unitId, extra = 0;
  for (let hops = 0; id && hops < 8; hops++) {
    const hit = unitLocs.find((r) => r.unit_id === id && r._range.lo <= day && (r._range.hi == null || day <= r._range.hi));
    if (hit) return { loc: hit, extra, via: id };
    id = parentOf(id, day);
    extra += UNIT_STEP_KM[U.get(id)?.kind] ?? 10;
  }
  return null;
}
function posting(soldierId, day) {
  return postings.find((r) => r.soldier_id === soldierId && r._range.lo <= day && (r._range.hi == null || day <= r._range.hi));
}

function trackFor(s) {
  // Events are read in the order they are written for each soldier. A vague date ("Jul 1944")
  // listed after a precise one ("8 Jul 1944") starts no earlier than the row before it.
  const own = events.filter((e) => e.soldier_id === s.soldier_id && e.place_id);
  // Consecutive stops with the same vague date ("March 1945" three times) are spread evenly across it.
  let prev = -Infinity;
  for (let i = 0; i < own.length; ) {
    const e = own[i];
    let j = i + 1;
    while (j < own.length && own[j]._range.lo === e._range.lo && own[j]._range.hi === e._range.hi && e._range.hi != null && e._range.hi > e._range.lo) j++;
    const n = j - i, span = e._range.hi == null ? 0 : e._range.hi - e._range.lo + 1;
    for (let k = i; k < j; k++) {
      const ev = own[k];
      if (ev._range.hi != null && ev._range.hi < prev) warn(`${ev._where}: out of order (ends before the row above starts)`);
      const spread = n > 1 ? ev._range.lo + Math.floor(((k - i) * span) / n) : ev._range.lo;
      ev._start = Math.max(spread, prev + (ev._range.lo <= prev ? 1 : 0));
      prev = ev._start;
    }
    i = j;
  }
  const days = [];
  for (let d = 0; d <= LAST_DAY; d++) {
    let row = null;
    const ev = [...own].reverse().find((e) => e._start <= d);
    const post = posting(s.soldier_id, d);
    const up = post ? unitPos(post.unit_id, d) : null;
    // A unit location that day beats a stale personal event from an earlier period.
    if (up && (!ev || (ev._range.hi != null && ev._range.hi < d))) {
      const pl = P.get(up.loc.place_id);
      row = { place: pl.place_id, r: (+up.loc.precision_km || +pl.precision_km || 5) + up.extra, conf: up.extra ? 'inherited' : up.loc.confidence, src: up.loc.source_id, status: up.loc.status, how: 'unit', unit: up.via, fact: up.loc.location_id };
    } else if (ev) {
      const pl = P.get(ev.place_id);
      row = { place: pl.place_id, r: +pl.precision_km || 5, conf: ev.confidence, src: ev.source_id, status: ev.status, how: 'event', fact: ev.event_id };
    }
    days.push(row);
  }
  // Compress runs of identical days into spans.
  const spans = [];
  days.forEach((row, d) => {
    const key = row && `${row.place}|${row.r}|${row.fact}`;
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.to = d;
    else spans.push({ key, from: d, to: d, ...row });
  });
  return spans.filter((x) => x.place).map(({ key, ...x }) => ({ ...x, from: dayToIso(x.from), to: dayToIso(x.to) }));
}

// ---------- close by ----------
const CLOSE_KM = 10;
function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function dailyLookup(track) {
  const out = new Array(LAST_DAY + 1).fill(null);
  for (const s of track) for (let d = dayIndex(s.from); d <= dayIndex(s.to); d++) out[d] = s;
  return out;
}
function closeBy(a, b, ta, tb) {
  const da = dailyLookup(ta), db = dailyLookup(tb), episodes = [];
  let cur = null;
  const start = dayIndex('1939-09-01');
  for (let d = start; d <= LAST_DAY; d++) {
    const x = da[d], y = db[d];
    let tier = null, dist = null;
    if (x && y) {
      const px = P.get(x.place), py = P.get(y.place);
      dist = km({ lon: +px.lon, lat: +px.lat }, { lon: +py.lon, lat: +py.lat });
      if (x.unit && x.unit === y.unit) tier = 'same_unit';
      else if (dist + x.r + y.r <= CLOSE_KM) tier = 'likely';
      else if (dist - x.r - y.r <= CLOSE_KM) tier = 'possibly';
    }
    if (tier) {
      if (cur && cur.to === d - 1 && cur.pa === x.place && cur.pb === y.place) { cur.to = d; if (dist < cur.minKm) { cur.minKm = dist; cur.closest = d; cur.a = x; cur.b = y; } if (rank(tier) > rank(cur.tier)) cur.tier = tier; }
      else { cur = { from: d, to: d, minKm: dist, closest: d, tier, a: x, b: y, pa: x.place, pb: y.place }; episodes.push(cur); }
    }
  }
  return episodes.map((e) => ({
    human_note: humanNote(a, b, e),
    soldiers: [a.soldier_id, b.soldier_id], from: dayToIso(e.from), to: dayToIso(e.to), closest: dayToIso(e.closest),
    km: Math.round(e.minKm * 10) / 10, tier: e.tier, places: [P.get(e.a.place).name, P.get(e.b.place).name],
    sources: [...new Set([e.a.src, e.b.src])], facts: [e.a.fact, e.b.fact], note: note(a, b, e),
  }));
}
// A hand-written note belongs to an episode when one of its named events covers part of the episode.
// Best match: the note naming both stops the episode is built on, then one naming either, then date overlap.
function humanNote(a, b, e) {
  const cover = (id) => { const ev = E.get(id); const lo = ev._start ?? ev._range.lo; const hi = ev._range.hi ?? lo + 365; return lo <= e.to && Math.max(hi, lo) >= e.from; };
  const facts = [e.a.fact, e.b.fact];
  let best = null, bestScore = 0;
  for (const n of notes) {
    if (!((n.soldier_a === a.soldier_id && n.soldier_b === b.soldier_id) || (n.soldier_a === b.soldier_id && n.soldier_b === a.soldier_id))) continue;
    const ids = [...n.events_a.split(';'), ...n.events_b.split(';')].filter(Boolean);
    const score = facts.filter((f) => ids.includes(f)).length * 10 + (ids.some(cover) ? 1 : 0);
    if (score > bestScore) { best = n; bestScore = score; }
  }
  if (best) best._used = true;
  return best ? { title: best.title, text: best.text, events: [...best.events_a.split(';'), ...best.events_b.split(';')].filter(Boolean) } : null;
}
const MON = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const niceDate = (d) => { const [y, m, dd] = dayToIso(d).split('-').map(Number); return `${MON[m - 1]} ${dd}, ${y}`; };
const rank = (t) => ({ possibly: 1, likely: 2, same_unit: 3 })[t] || 0;
const first = (s) => s.display_name.split(' ')[0];

// Template note. Never says the men met: no source in this pipeline records contact.
function note(a, b, e) {
  const when = e.from === e.to ? niceDate(e.from) : `${niceDate(e.from)} to ${niceDate(e.to)}`;
  const pa = P.get(e.a.place).name, pb = P.get(e.b.place).name;
  const where = pa === pb ? `both near ${pa}` : `${first(a)} near ${pa} and ${first(b)} near ${pb}, about ${Math.round(e.minKm)} km apart`;
  const soft = [e.a, e.b].filter((x) => x.conf !== 'documented').length
    ? ' At least one position is estimated, so the real distance may have been larger or smaller.' : '';
  return `From ${when}, the records put ${where}.${soft} No record says they met.`.replace(/^From (\w+\.? \d+, \d{4}), the/, 'On $1, the');
}

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'soldier'), { recursive: true });
// Vendor the map libraries so the site has no CDN dependency.
const VENDOR = path.join(ROOT, 'site', 'data', 'vendor');
// The date parser is shared with the contribute page.
fs.mkdirSync(path.join(ROOT, 'site', 'data', 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'lib', 'dates.mjs'), path.join(ROOT, 'site', 'data', 'lib', 'dates.mjs'));
fs.mkdirSync(VENDOR, { recursive: true });
if (fs.existsSync(path.join(DATA, 'media'))) fs.cpSync(path.join(DATA, 'media'), path.join(OUT, 'media'), { recursive: true });
for (const f of ['d3/dist/d3.min.js', 'topojson-client/dist/topojson-client.min.js', 'world-atlas/countries-50m.json', 'world-atlas/countries-110m.json', 'maplibre-gl/dist/maplibre-gl.js', 'maplibre-gl/dist/maplibre-gl.css']) {
  const from = path.join(ROOT, 'node_modules', f);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(VENDOR, path.basename(f)));
  else warn(`node_modules/${f} missing; run npm install`);
}
const pub = soldiers.filter((s) => s.privacy === 'public');
const tracks = new Map(pub.map((s) => [s.soldier_id, trackFor(s)]));
const placeOut = Object.fromEntries(places.map((p) => [p.place_id, { name: p.name, lon: +p.lon, lat: +p.lat }]));

const strip = ({ _where, _range, _start, ...r }) => r;
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  built: new Date().toISOString().slice(0, 10), day0: DAY0,
  soldiers: pub.map((s) => {
    const born = parseDate(s.birth_date);
    const face = fs.existsSync(path.join(DATA, 'media', `face-${s.soldier_id}.jpg`)) ? `data/media/face-${s.soldier_id}.jpg` : '';
    const unit = postings.find((p) => p.soldier_id === s.soldier_id);
    return { id: s.soldier_id, name: s.display_name, rank: s.rank, born: born ? dayToIso(born.lo) : '', face, unit: unit ? U.get(unit.unit_id).name : '' };
  }),
  landmarks: landmarks.map((l) => ({ name: l.name, kind: l.kind, lon: +l.lon, lat: +l.lat, maxKm: +l.max_view_km || 400, d: l.description })),
  glossary: glossary.map((g) => [g.term, g.note]),
  sheets: sheets.map((m) => ({ id: m.sheet_id, name: m.name, scale: m.scale, kind: m.kind, pub: m.published, b: [+m.west, +m.south, +m.east, +m.north] })),
  units: Object.fromEntries(units.map((u) => [u.unit_id, { name: u.name, kind: u.kind, parent: u.parent_id, project44: u.project44_url || '' }])),
  places: placeOut,
  sources: Object.fromEntries(sources.map((s) => [s.source_id, strip(s)])),
}, null, 1));

for (const s of pub) {
  fs.writeFileSync(path.join(OUT, 'soldier', s.soldier_id + '.json'), JSON.stringify({
    soldier: strip(s),
    postings: postings.filter((p) => p.soldier_id === s.soldier_id).map(strip),
    events: events.filter((e) => e.soldier_id === s.soldier_id).map((e) => ({ ...strip(e), start: dayToIso(e._start ?? e._range.lo), end: e._range.hi == null ? null : dayToIso(e._range.hi), quotes: quotes.filter((q) => q.event_id === e.event_id).map(strip) })),
    conflicts: conflicts.filter((c) => c.soldier_id === s.soldier_id).map(strip),
    track: tracks.get(s.soldier_id),
  }, null, 1));
}

const pairs = [];
for (let i = 0; i < pub.length; i++) for (let j = i + 1; j < pub.length; j++) pairs.push(...closeBy(pub[i], pub[j], tracks.get(pub[i].soldier_id), tracks.get(pub[j].soldier_id)));
fs.writeFileSync(path.join(OUT, 'closeby.json'), JSON.stringify(pairs, null, 1));

for (const n of notes) if (!n._used) warn(`${n._where}: hand-written note "${n.title}" matched no computed episode`);
if (warnings.length) { console.warn(`${warnings.length} warning(s):`); warnings.forEach((w) => console.warn('  ' + w)); }
console.log(`Built ${pub.length} soldier(s), ${places.length} places, ${pairs.length} close-by episode(s) -> site/data/`);
