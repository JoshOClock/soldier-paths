// Turn a submission from the "Add a soldier" page into rows in data/*.csv.
//   node scripts/import_submission.mjs path/to/name.soldier.json [--public] [--dry-run]
// Adds the soldier (private unless --public), his places, sources, events, quotes and postings.
// Units are matched to data/units.csv by name; unknown units are added as new top-level units
// for a person to place in the hierarchy later. Everything arrives with status "family" if the
// submitter marked it family, otherwise "ai_draft", since the submitter's AI wrote it.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './lib/csv.mjs';
import { parseDate } from './lib/dates.mjs';
import { extractJson, validate } from '../site/submit/check.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
const PUBLIC = args.includes('--public'), DRY = args.includes('--dry-run');
if (!file) { console.error('usage: node scripts/import_submission.mjs file.json [--public] [--dry-run]'); process.exit(1); }

const sub = extractJson(fs.readFileSync(file, 'utf8'));
const { errors, warnings, stops } = validate(sub, parseDate);
for (const w of warnings) console.warn('warning:', w);
if (errors.length) { for (const e of errors) console.error('error:', e); process.exit(1); }

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const read = (n) => { const p = path.join(DATA, n + '.csv'); const { header, rows } = parseCsv(fs.readFileSync(p, 'utf8')); return { p, head: header, rows }; };
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const add = {};
const push = (table, row) => { (add[table] ||= []).push(row); };

const T = Object.fromEntries(['soldiers', 'places', 'sources', 'events', 'quotes', 'postings', 'units'].map((n) => [n, read(n)]));
const has = (table, key, id) => T[table].rows.some((r) => r[key] === id) || (add[table] || []).some((r) => r[key] === id);

const so = sub.soldier;
let sid = slug(so.name);
if (has('soldiers', 'soldier_id', sid)) sid = slug(so.name + ' ' + (so.service_number || Date.now()));
const conf = (c) => ({ documented: 'documented', family: 'family', estimated: 'inferred' }[c] || 'inferred');
const status = (c) => (c === 'family' ? 'family' : 'ai_draft');

// Places: reuse an existing place within a kilometre or so with the same first word of the name, else add.
function placeFor(p) {
  const near = [...T.places.rows, ...(add.places || [])].find((r) => Math.abs(+r.lat - p.lat) < 0.01 && Math.abs(+r.lon - p.lon) < 0.015);
  if (near) return near.place_id;
  let id = slug(p.name.split(',')[0]); if (has('places', 'place_id', id)) id = slug(p.name);
  if (has('places', 'place_id', id)) id = `${id}-${String(p.lat).replace('.', '')}`;
  push('places', { place_id: id, name: p.name, lon: p.lon, lat: p.lat, precision_km: p.precision_km || 5, note: `From submission for ${so.name}` });
  return id;
}

const birth = sub.soldier.born?.place ? (stops.find((e) => e.kind === 'birth')?.place) : null;
push('soldiers', { soldier_id: sid, display_name: so.name, service_number: so.service_number || '', rank: so.rank || '', birth_date: so.born?.date || '', birth_place_id: birth ? placeFor(birth) : '', death_date: so.died?.date || '', war: 'WW2', privacy: PUBLIC ? 'public' : 'private', note: `Submitted by ${sub.submitted_by?.name || 'unknown'} (${sub.submitted_by?.relationship || 'relationship not given'})${sub.notes ? '. ' + sub.notes : ''}` });

const srcMap = {};
const kindMap = { service_file: 'archival', newspaper: 'newspaper', letter: 'family', photo: 'family', family: 'family', book: 'book', website: 'website', other: 'other' };
for (const s of sub.sources) {
  let id = `src-${sid}-${slug(s.id)}`;
  srcMap[s.id] = id;
  push('sources', { source_id: id, kind: kindMap[s.kind] || 'other', title: s.title, archive_ref: s.where_held || '', url: s.url || '', rights: s.kind === 'family' || s.kind === 'letter' || s.kind === 'photo' ? 'family' : '', citation: s.date ? `Dated ${s.date}` : '' });
}

const unitIdFor = (name) => {
  const n = name.toLowerCase();
  const hit = [...T.units.rows, ...(add.units || [])].find((u) => u.name.toLowerCase() === n || (u.short_name && u.short_name.toLowerCase() === n));
  if (hit) return hit.unit_id;
  const id = slug(name);
  if (!has('units', 'unit_id', id)) push('units', { unit_id: id, name, short_name: '', kind: '', parent_id: '', war: 'WW2', project44_url: '', note: `Added from submission for ${so.name}; place in hierarchy` });
  return id;
};
(sub.units || []).forEach((u, i) => {
  push('postings', { posting_id: `p-${sid}-${i + 1}`, soldier_id: sid, unit_id: unitIdFor(u.name), date_from: u.from || '', date_to: u.to || '', role: u.role || '', source_id: srcMap[u.source] || '', confidence: conf(u.confidence), status: status(u.confidence), note: '' });
});

const KIND = { birth: 'birth', enlistment: 'enlistment', promotion: 'promotion', award: 'award', discharge: 'discharge', death: 'death', wounded: 'wounded' };
stops.forEach((e, i) => {
  const eid = `${sid}-${String(i + 1).padStart(2, '0')}`;
  push('events', { event_id: eid, soldier_id: sid, kind: KIND[e.kind] || 'location', date: e.date, place_id: placeFor(e.place), unit_id: '', detail: e.what, source_id: srcMap[e.source], confidence: conf(e.confidence), status: status(e.confidence), note: e.note || '' });
  if (e.quote) push('quotes', { quote_id: `${eid}-q1`, event_id: eid, source_id: srcMap[e.source], page_ref: e.page || '', label: `From ${sub.sources.find((s) => s.id === e.source)?.title || 'the source'}`, text: e.quote });
});

for (const [table, rows] of Object.entries(add)) {
  const { p, head } = T[table];
  const lines = rows.map((r) => head.map((h) => cell(r[h])).join(','));
  console.log(`${table}: +${rows.length}`);
  if (!DRY) { const t = fs.readFileSync(p, 'utf8'); fs.writeFileSync(p, (t.endsWith('\n') ? t : t + '\n') + lines.join('\n') + '\n'); }
}
console.log(DRY ? 'Dry run: nothing written.' : `Added ${so.name} as ${sid} (${PUBLIC ? 'public' : 'private'}). Run npm run build to check.`);
