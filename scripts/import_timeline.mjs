// One-off import: data/import/grandfathers_timeline.json -> data/*.csv
// Re-runnable: it rewrites events, quotes, places, sources and close-by notes for the two grandfathers.
// Run: node scripts/import_timeline.mjs

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/import/grandfathers_timeline.json'), 'utf8'));
const WHO = { brown: 'clayton-brown', sweet: 'gordon-sweet' };

// Stops that belong to someone else's story (shown as "Meanwhile" in the prototype, or about Minerva).
const SKIP = new Set([
  'Both home',
  'Student council president, Alberta College',
  'At home in Bremner',
  'Hospital Auxiliary, I.O.D.E. and the skating club',
]);

// How precise each place name is, in km. Default 3 km for a town.
const PRECISION = { 'Normandy coast': 15, 'South Beveland': 15, 'The Seine': 15, 'Frisian Islands': 40, England: 150, Canada: 1000, Hochwald: 5, 'Juno Beach': 8 };
const PLACE_NOTE = {
  England: 'Camp in England not recorded; centre of southern England',
  Canada: 'Port of arrival not recorded; plotted at Halifax',
  'The Seine': 'Crossing point not recorded; plotted at Elbeuf',
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Map a quote's source label to a source record plus a page reference.
function sourceOf(label) {
  const page = (label.match(/\bpp?\. ?[\d]+(?: and \d+)?/) || [''])[0];
  if (/Lynda's booklet/.test(label)) return { id: 'src-lynda-booklet', kind: 'family', title: "Lynda Brown's booklet on Clayton's service (typed, from interviews with him)", page };
  if (/Bruce W\. Young/.test(label)) return { id: 'src-young-2025', kind: 'book', title: 'Bruce W. Young, 20th Battery, 2 Antitank (A/T), 2nd Canadian Infantry Division 1939-1945: A Personal View (2025)', page };
  if (/Edmondson/.test(label)) return { id: 'src-edmondson-2005', kind: 'article', title: 'John S. Edmondson and R.D. Edmondson, "The Pawns of War", Canadian Military History 14, no. 4 (2005)', page };
  if (/Award recommendation/.test(label)) return { id: 'src-lac-grassick-award', kind: 'archival', title: 'Award recommendation for M1026 Bdr George Albert Grassick, 2 Cdn A.Tk Regt RCA (LAC, reproduced in Young, Figure 55)', page };
  if (/Quiet Service/.test(label)) return { id: 'src-quiet-service', kind: 'family', title: 'The Quiet Service of Captain Gordon Carlyle Sweet, M.B.E. (family history drawn from his service file)', page: label.startsWith('From The Quiet Service') ? '' : label };
  const paper = label.match(/(Lacombe Globe|Red Deer Advocate|Edmonton Bulletin)/);
  if (paper) {
    const title = label.replace(/^From (the )?/, '').replace(/ \(photo caption\)$/, '');
    return { id: 'src-' + slug(title).slice(0, 60), kind: 'newspaper', title, page };
  }
  return { id: 'src-' + slug(label).slice(0, 60), kind: 'other', title: label, page };
}

function kindOf(h) {
  if (/^Born/.test(h)) return 'birth';
  if (/^Enlists/.test(h)) return 'enlistment';
  if (/^Married|^Minerva/.test(h)) return 'marriage';
  if (/Order of the British Empire|M\.B\.E\. presented/.test(h)) return 'award';
  if (/Out of the army|Calgary, then Lacombe/.test(h)) return 'discharge';
  if (/private to officer/.test(h)) return 'promotion';
  return 'location';
}

// Dates as written in the prototype that need a small rewrite for the date reader.
const DATE_FIX = { 'Winter 1944 to 1945': 'Winter 1944', '1950s and 1960s': '1950 to 1969', 'Late Aug. 1944': 'Late Aug. 1944' };

const places = new Map(), sources = new Map(), events = [], quotes = [];
for (const [key, soldier] of Object.entries(WHO)) {
  let n = 0;
  for (const stop of src[key]) {
    if (stop.headline.startsWith('Meanwhile') || SKIP.has(stop.headline)) continue;
    const pid = slug(stop.place);
    if (!places.has(pid)) places.set(pid, { place_id: pid, name: stop.place, lon: stop.lon, lat: stop.lat, precision_km: PRECISION[stop.place] ?? 3, note: PLACE_NOTE[stop.place] || '' });
    const eid = `${soldier}-${String(++n).padStart(2, '0')}`;
    const qs = stop.quotes.map((q) => ({ q, s: sourceOf(q.source) }));
    for (const { s } of qs) if (!sources.has(s.id)) sources.set(s.id, s);
    const primary = qs.find(({ s }) => s.kind !== 'family') || qs[0];
    events.push({
      event_id: eid, soldier_id: soldier, kind: kindOf(stop.headline), date: DATE_FIX[stop.date] || stop.date, place_id: pid,
      unit_id: '', detail: stop.headline,
      source_id: primary ? primary.s.id : 'src-prototype',
      confidence: qs.some(({ s }) => s.kind !== 'family') ? 'documented' : 'family',
      status: 'family',
      note: qs.length ? '' : 'From the prototype; no quoted source yet',
    });
    qs.forEach(({ q, s }, i) => quotes.push({ quote_id: `${eid}-q${i + 1}`, event_id: eid, source_id: s.id, page_ref: s.page, label: q.source, text: q.text }));
  }
}
sources.set('src-prototype', { id: 'src-prototype', kind: 'family', title: "Two Grandfathers' War prototype (Josh Brown)", page: '' });

// Hand-written close-by notes from the prototype: link each to the events it names.
const byHeadline = (soldier, h) => events.find((e) => e.soldier_id === soldier && e.detail === h)?.event_id;
const notes = src.close_by.map((c, i) => ({
  note_id: `cb-${i + 1}`,
  soldier_a: 'clayton-brown', events_a: c.b.map((h) => byHeadline('clayton-brown', h)).filter(Boolean).join(';'),
  soldier_b: 'gordon-sweet', events_b: c.s.map((h) => byHeadline('gordon-sweet', h)).filter(Boolean).join(';'),
  title: c.title, text: c.text, source_id: 'src-prototype',
}));

// ---------- write CSV ----------
const esc = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function write(name, cols, rows) {
  fs.writeFileSync(path.join(ROOT, 'data', name + '.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
}
write('places', ['place_id', 'name', 'lon', 'lat', 'precision_km', 'note'], [...places.values()].sort((a, b) => a.place_id.localeCompare(b.place_id)));
write('events', ['event_id', 'soldier_id', 'kind', 'date', 'place_id', 'unit_id', 'detail', 'source_id', 'confidence', 'status', 'note'], events);
write('quotes', ['quote_id', 'event_id', 'source_id', 'page_ref', 'label', 'text'], quotes);
write('sources', ['source_id', 'kind', 'title', 'archive_ref', 'url', 'rights', 'citation'],
  [...sources.values()].map((s) => ({ source_id: s.id, kind: s.kind, title: s.title, url: s.id === 'src-prototype' ? 'https://claude.ai/artifact/3cXHvZA21m9yzddYw6Jbnm' : '', rights: s.kind === 'family' ? 'family' : '' })));
write('closeby_notes', ['note_id', 'soldier_a', 'events_a', 'soldier_b', 'events_b', 'title', 'text', 'source_id'], notes);
console.log(`${events.length} events, ${quotes.length} quotes, ${places.size} places, ${sources.size} sources, ${notes.length} close-by notes`);
