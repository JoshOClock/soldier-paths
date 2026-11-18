// Checks a soldier submission (format soldier-paths/1). Used by the contribute page and by
// scripts/import_submission.mjs, so both agree on what's acceptable.
// parseDate is passed in (scripts/lib/dates.mjs) so this file has no imports.

export const FORMAT = 'soldier-paths/1';
export const CONF = ['documented', 'family', 'estimated'];
export const KINDS = ['birth', 'enlistment', 'training', 'posting', 'embarkation', 'location', 'battle', 'wounded', 'promotion', 'award', 'leave', 'return', 'discharge', 'death', 'other'];
export const SOURCE_KINDS = ['service_file', 'newspaper', 'letter', 'photo', 'family', 'book', 'website', 'other'];

// Pull the JSON out of whatever the person pasted: a bare object, or a reply with a ```json block.
export function extractJson(text) {
  const t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

export function validate(s, parseDate) {
  const errors = [], warnings = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); return cond; };
  const warn = (cond, msg) => { if (!cond) warnings.push(msg); return cond; };
  if (!need(s && typeof s === 'object', 'This isn\'t a JSON object.')) return { errors, warnings, stops: [] };
  warn(s.format === FORMAT, `"format" should be "${FORMAT}".`);

  const so = s.soldier || {};
  need(so.name && so.name.trim().split(/\s+/).length >= 2, 'The soldier needs a full name (at least first and last).');
  warn(so.service_number, 'No service number. That\'s fine, but it\'s the surest way to tell two men with the same name apart.');
  for (const k of ['born', 'died']) if (so[k]?.date) warn(parseDate(so[k].date), `The ${k === 'born' ? 'birth' : 'death'} date "${so[k].date}" isn't in a form the site understands.`);

  const srcIds = new Set();
  const sources = Array.isArray(s.sources) ? s.sources : [];
  need(sources.length, 'There are no sources. Every fact needs to say where it came from.');
  sources.forEach((x, i) => {
    if (!need(x && x.id, `Source ${i + 1} has no "id".`)) return;
    need(!srcIds.has(x.id), `Two sources share the id "${x.id}".`); srcIds.add(x.id);
    need(x.title, `Source "${x.id}" has no title.`);
    warn(SOURCE_KINDS.includes(x.kind), `Source "${x.id}" has kind "${x.kind}"; expected one of ${SOURCE_KINDS.join(', ')}.`);
  });

  const units = Array.isArray(s.units) ? s.units : [];
  warn(units.length, 'No units listed. Without a unit the site can only show the places in the events.');
  units.forEach((u, i) => {
    need(u.name, `Unit ${i + 1} has no name.`);
    if (u.from) warn(parseDate(u.from), `Unit "${u.name}": the start date "${u.from}" isn't in a form the site understands.`);
    if (u.to) warn(parseDate(u.to), `Unit "${u.name}": the end date "${u.to}" isn't in a form the site understands.`);
    if (u.source) need(srcIds.has(u.source), `Unit "${u.name}" points to source "${u.source}", which isn't in the sources list.`);
  });

  const events = Array.isArray(s.events) ? s.events : [];
  need(events.length, 'There are no events.');
  const stops = [];
  events.forEach((e, i) => {
    const label = `Event ${i + 1}${e.what ? ` ("${String(e.what).slice(0, 40)}")` : ''}`;
    need(e.what, `${label} has no description in "what".`);
    const d = e.date ? parseDate(e.date) : null;
    need(d, e.date ? `${label}: the date "${e.date}" isn't in a form the site understands.` : `${label} has no date.`);
    const p = e.place || {};
    const hasXY = typeof p.lat === 'number' && typeof p.lon === 'number' && !(p.lat === 0 && p.lon === 0);
    need(p.name, `${label} has no place name.`);
    need(hasXY && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180, `${label}: the place needs a latitude and longitude.`);
    need(e.source && srcIds.has(e.source), `${label} needs a "source" that matches one in the sources list.`);
    warn(CONF.includes(e.confidence), `${label}: "confidence" should be one of ${CONF.join(', ')}.`);
    warn(!e.kind || KINDS.includes(e.kind), `${label}: kind "${e.kind}" isn't one of the listed kinds; it will be shown as "other".`);
    if (e.quote && e.quote.split(/\s+/).length > 40) warnings.push(`${label}: the quote is long. Keep quotes short, a sentence or two.`);
    if (d) stops.push({ ...e, _lo: d.lo, _hi: d.hi, _i: i });
  });
  stops.sort((a, b) => a._lo - b._lo || a._i - b._i);
  // Big jumps between consecutive dated stops are usually a wrong date or a wrong place.
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (a.place && b.place && typeof a.place.lat === 'number' && typeof b.place.lat === 'number') {
      const km = haversine(a.place, b.place), days = Math.max(1, b._lo - a._lo);
      if (km > 3000 && days < 3) warnings.push(`"${a.what}" and "${b.what}" are ${Math.round(km)} km apart within ${days} day(s). Check the dates and places.`);
    }
  }
  return { errors, warnings, stops };
}

export function haversine(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
