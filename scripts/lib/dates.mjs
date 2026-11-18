// Fuzzy dates as people write them in records and family notes.
// parseDate returns { lo, hi, text } as day numbers since DAY0 (hi null = open-ended), or null.
// Accepts: 1944-06-19, 1944-06, 1944, 19 Jun 1944, Jun. 19, 1944, Jun 1944, June 1944,
// Winter 1944 (Dec 1944 to Feb 1945), Spring/Summer/Fall/Autumn 1944, Early/Mid/Late 1944,
// Early/Mid/Late Aug 1944, "A to B" ranges of any of these (Oct. to Nov. 1944 borrows the year), "1946 on" (open-ended), and "about"/"c."/"~" prefixes.

export const DAY0 = '1900-01-01';
const MS = 86400000, T0 = Date.UTC(1900, 0, 1);
export const dayIndex = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - T0) / MS);
export const dayToIso = (d) => new Date(T0 + d * MS).toISOString().slice(0, 10);
const ymd = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - T0) / MS);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const month = (s) => MONTHS[s.toLowerCase().replace(/\./g, '').slice(0, s.toLowerCase().startsWith('sept') ? 4 : 3)];

function single(s) {
  s = s.trim().replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { const v = ymd(+m[1], +m[2], +m[3]); return { lo: v, hi: v }; }
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return { lo: ymd(+m[1], +m[2], 1), hi: ymd(+m[1], +m[2], lastDay(+m[1], +m[2])) };
  if ((m = s.match(/^(\d{4})$/))) return { lo: ymd(+m[1], 1, 1), hi: ymd(+m[1], 12, 31) };
  if ((m = s.match(/^(\d{1,2}) ([A-Za-z]+\.?),? (\d{4})$/)) && month(m[2])) { const v = ymd(+m[3], month(m[2]), +m[1]); return { lo: v, hi: v }; }
  if ((m = s.match(/^([A-Za-z]+\.?) (\d{1,2}),? (\d{4})$/)) && month(m[1])) { const v = ymd(+m[3], month(m[1]), +m[2]); return { lo: v, hi: v }; }
  if ((m = s.match(/^(early|mid|late) ([A-Za-z]+\.?),? (\d{4})$/i)) && month(m[2])) {
    const y = +m[3], mo = month(m[2]), L = lastDay(y, mo), part = m[1].toLowerCase();
    if (part === 'early') return { lo: ymd(y, mo, 1), hi: ymd(y, mo, 10) };
    if (part === 'mid') return { lo: ymd(y, mo, 11), hi: ymd(y, mo, 20) };
    return { lo: ymd(y, mo, 21), hi: ymd(y, mo, L) };
  }
  if ((m = s.match(/^([A-Za-z]+\.?),? (\d{4})$/))) {
    const y = +m[2], w = m[1].toLowerCase();
    if (month(m[1])) { const mo = month(m[1]); return { lo: ymd(y, mo, 1), hi: ymd(y, mo, lastDay(y, mo)) }; }
    if (w === 'winter') return { lo: ymd(y, 12, 1), hi: ymd(y + 1, 2, lastDay(y + 1, 2)) };
    if (w === 'spring') return { lo: ymd(y, 3, 1), hi: ymd(y, 5, 31) };
    if (w === 'summer') return { lo: ymd(y, 6, 1), hi: ymd(y, 8, 31) };
    if (w === 'fall' || w === 'autumn') return { lo: ymd(y, 9, 1), hi: ymd(y, 11, 30) };
    if (w === 'early') return { lo: ymd(y, 1, 1), hi: ymd(y, 4, 30) };
    if (w === 'mid') return { lo: ymd(y, 5, 1), hi: ymd(y, 8, 31) };
    if (w === 'late') return { lo: ymd(y, 9, 1), hi: ymd(y, 12, 31) };
  }
  return null;
}

export function parseDate(text) {
  if (!text) return null;
  let s = text.trim().replace(/^(about|approx\.?|c\.|ca\.|~)\s*/i, '');
  const approx = s !== text.trim();
  let r;
  const on = s.match(/^(.*) on(wards)?$/i);
  if (on) { const a = single(on[1]); r = a && { lo: a.lo, hi: null }; }
  else if (s.includes(' to ')) {
    let [x, y] = s.split(' to ');
    // "Oct. to Nov. 1944": the left side borrows the year from the right.
    const year = y.match(/(\d{4})$/);
    if (year && !/\d{4}$/.test(x)) x = x + ' ' + year[1];
    const [a, b] = [single(x), single(y)];
    r = a && b && b.hi >= a.lo ? { lo: a.lo, hi: b.hi } : null;
  }
  else r = single(s);
  if (!r) return null;
  if (approx) { r.lo -= 15; if (r.hi != null) r.hi += 15; }
  return { ...r, text };
}
