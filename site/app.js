// Soldier Paths viewer: sticky map, to-scale timeline and scrolling story, built from site/data/*.json.
// One clock: `curT` (ms since epoch) is set by scrolling or the timeline; the map, caption and pins read it.
'use strict';

const DAY = 86400000;
const Y0 = Date.UTC(1939, 8, 1), Y1 = Date.UTC(1946, 11, 31);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ms = (iso) => Date.parse(iso + 'T00:00:00Z');
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const first = (name) => name.split(' ')[0];
const fmtDate = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');

let GEO, IDX, CLOSE, LAND, BORDERS, DOCS = {}, SELF, STEPS = [], curT = null, active = -1, showOthers = true;
const FACES = {};

// ---------------- data ----------------
async function boot() {
  [IDX, CLOSE] = await Promise.all([fetch('data/index.json').then((r) => r.json()), fetch('data/closeby.json').then((r) => r.json())]);
  // Two detail levels: coarse for the zoomed-out globe, fine for close views. Land is merged into one shape.
  const [w50, w110] = await Promise.all(['50m', '110m'].map((r) => fetch(`data/vendor/countries-${r}.json`).then((x) => x.json())));
  const lod = (w) => ({ land: topojson.merge(w, w.objects.countries.geometries), borders: topojson.mesh(w, w.objects.countries, (a, b) => a !== b) });
  GEO = { fine: lod(w50), coarse: lod(w110) };
  LAND = GEO.coarse.land;
  await Promise.all(IDX.soldiers.map(async (s) => {
    DOCS[s.id] = await fetch(`data/soldier/${s.id}.json`).then((r) => r.json());
    if (s.face) { const im = new Image(); im.onload = () => draw(); im.src = s.face; FACES[s.id] = im; }
  }));
  buildTabs();
  const want = location.hash.slice(1);
  select(IDX.soldiers.some((s) => s.id === want) ? want : IDX.soldiers[0].id, null);
}

const place = (id) => IDX.places[id];
const soldier = (id) => IDX.soldiers.find((s) => s.id === id);

// Where a soldier is at time t: his own stops in order, interpolated along the way between them.
const STOPS = {};
function stopsOf(id) {
  return STOPS[id] ||= DOCS[id].events.filter((e) => e.place_id).map((e) => ({ e, t: ms(e.start), p: [place(e.place_id).lon, place(e.place_id).lat] }));
}
function positionAt(id, t) {
  const st = stopsOf(id);
  let i = -1;
  st.forEach((s, k) => { if (s.t <= t) i = k; });
  if (i < 0) return null;
  return { stop: st[i], p: st[i].p, name: place(st[i].e.place_id).name, i };
}

// ---------------- tabs ----------------
function buildTabs() {
  const nav = $('tabs');
  nav.innerHTML = IDX.soldiers.map((s) => `<button role="tab" data-id="${s.id}" aria-selected="false">${esc(s.name.replace(/,.*$/, ''))}</button>`).join('') +
    `<button type="button" class="eye" id="eye" aria-pressed="true" title="Show or hide the other soldiers on the map">others on map</button>`;
  nav.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => select(b.dataset.id, curT)));
  $('eye').addEventListener('click', (e) => { showOthers = !showOthers; e.target.setAttribute('aria-pressed', showOthers); draw(); });
  const h = () => document.documentElement.style.setProperty('--tabh', nav.offsetHeight + 'px');
  h(); addEventListener('resize', h);
}

function select(id, keepT) {
  SELF = id;
  history.replaceState(null, '', '#' + id);
  document.querySelectorAll('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.id === id));
  renderStory();
  // Keep the globe where it is; go() then glides from the current view to the new soldier's stop.
  active = -2; curT = null; switching = true;
  tlDraw();
  if (keepT != null) requestAnimationFrame(() => seek(keepT)); else { scrollTo(0, 0); onScroll(); }
}

// ---------------- story ----------------
function region(p, t) {
  const [lon, lat] = p;
  if (lon < -50) return 'na';
  if (lon > -8 && lon < 2 && lat > 50.3 && lat < 59 && !(lon > 1 && lat < 51.2)) return 'uk';
  return t >= Date.UTC(1944, 5, 1) && t < Date.UTC(1945, 6, 1) ? 'nwe' : 'eu';
}
const CHAPTER = { pre: 'Before the war', na: 'In uniform in Canada', uk: 'England', nwe: 'Northwest Europe', eu: 'Europe', home: 'Home' };

function chaptersFor(id) {
  const st = stopsOf(id), out = [];
  for (const s of st) {
    let key = s.t < Y0 ? 'pre' : region(s.p, s.t);
    if (key === 'na' && s.t >= Date.UTC(1945, 4, 8)) key = 'home';
    if (key === 'eu' && s.t >= Date.UTC(1945, 6, 1)) key = 'home';
    const last = out[out.length - 1];
    if (last && last.key === key) last.stops.push(s); else out.push({ key, stops: [s] });
  }
  return out;
}

function unitOn(id, iso) {
  const p = DOCS[id].postings.find((x) => x.status !== 'disputed' && inRange(iso, x));
  const d = DOCS[id].postings.filter((x) => x.status === 'disputed' && inRange(iso, x));
  return { main: p ? IDX.units[p.unit_id]?.name : '', disputed: d.map((x) => IDX.units[x.unit_id]?.name) };
}
function inRange(iso, x) {
  // Posting dates in the CSV are written loosely; compare on year-month-day prefix where possible.
  const lo = looseIso(x.date_from, false), hi = x.date_to ? looseIso(x.date_to, true) : '9999';
  return lo <= iso && iso <= hi;
}
function looseIso(s, end) {
  const m = s.match(/(\d{1,2} )?([A-Za-z]{3,})\.? ?(\d{4})?$/), y = (s.match(/\d{4}/) || ['1900'])[0];
  const mon = m && { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }[m[2].slice(0, 3).toLowerCase()];
  const d = s.match(/^(\d{1,2}) /);
  if (!mon) return end ? y + '-12-31' : y + '-01-01';
  const mm = String(mon).padStart(2, '0');
  if (d) return `${y}-${mm}-${d[1].padStart(2, '0')}`;
  return end ? `${y}-${mm}-31` : `${y}-${mm}-01`;
}

function gloss(html) {
  // Dotted-underline notes on known terms; the quoted words themselves are never changed.
  for (const [term, note] of IDX.glossary || []) {
    const re = new RegExp(`(^|[^\\w>])(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\w<])`);
    html = html.replace(re, `$1<abbr data-g="${esc(note)}" tabindex="0">$2</abbr>`);
  }
  return html;
}
function quoteBlock(q) {
  const src = IDX.sources[q.source_id] || {};
  const cls = src.kind === 'family' ? 'journal' : 'globe';
  const body = esc(q.text).split(/\n\n+/).map((p) => `<p>${gloss(p)}</p>`).join('');
  return `<blockquote class="${cls}"><div class="jl">${esc(q.label || src.title)}</div>${body}</blockquote>`;
}
const SECONDARY = new Set(['book', 'article']);
const CONF = { documented: ['c-doc', 'documented'], family: ['c-fam', 'family record'], inherited: ['c-inf', 'from his unit'], inferred: ['c-inf', 'estimated'] };

function closeFor(id, from, to) {
  return CLOSE.filter((c) => c.soldiers.includes(id) && c.from <= to && c.to >= from && (c.human_note || c.tier !== 'possibly' || c.km < 25));
}

function renderStory() {
  const s = soldier(SELF), doc = DOCS[SELF], chapters = chaptersFor(SELF);
  const born = s.born ? fmtDate(ms(s.born)) : '';
  const bp = doc.soldier.birth_place_id ? place(doc.soldier.birth_place_id)?.name : '';
  let html = `<header class="hero">
    ${s.face ? `<img class="faceimg" src="${s.face}" width="84" height="84" alt="">` : ''}
    <div class="eyebrow">Soldier Paths · Second World War${doc.soldier.service_number ? ' · ' + esc(doc.soldier.service_number) : ''}</div>
    <h1>${esc(s.name)}</h1>
    <p class="unit">${esc(s.unit)}</p>
    <p class="lede">${esc(doc.soldier.rank)}. Born ${esc(born)}${bp ? ', ' + esc(bp) : ''}. Every stop below quotes its source exactly. Positions between stops are estimated, and a "close by" note never means the men met unless a record says so.</p>
    <p class="hint">Scroll to follow him. The timeline beside the map is to scale.</p>
  </header>`;
  STEPS = [];
  // Each close-by note appears once, on the stop it was written about (or the first stop it overlaps).
  const crossAt = new Map(), seenNote = new Set(), mine = stopsOf(SELF);
  for (const c of CLOSE.filter((c) => c.soldiers.includes(SELF) && (c.human_note || c.tier !== 'possibly' || c.km < 25))) {
    const key = c.human_note ? c.human_note.title : c.from + c.to;
    if (seenNote.has(key)) continue;
    const named = c.human_note && mine.find((st) => c.human_note.events.includes(st.e.event_id));
    const fact = mine.find((st) => c.facts.includes(st.e.event_id));
    const overlap = mine.find((st, i) => { const nx = mine[i + 1]; const to = nx ? new Date(nx.t - DAY).toISOString().slice(0, 10) : '1999-12-31'; return st.e.start <= c.to && to >= c.from; });
    const at = named || fact || overlap; if (!at) continue;
    seenNote.add(key);
    if (!crossAt.has(at.e.event_id)) crossAt.set(at.e.event_id, []);
    if (crossAt.get(at.e.event_id).length < 1) crossAt.get(at.e.event_id).push(c);
  }
  chapters.forEach((ch) => {
    const a = ch.stops[0], b = ch.stops[ch.stops.length - 1];
    const ya = new Date(a.t).getUTCFullYear(), yb = new Date(b.t).getUTCFullYear();
    const names = [...new Set(ch.stops.map((x) => place(x.e.place_id).name))];
    html += `<section class="chapter"><h2>${CHAPTER[ch.key]}</h2><div class="span">${esc(names[0])}${names.length > 1 ? ' to ' + esc(names[names.length - 1]) : ''} · ${ya === yb ? ya : ya + ' to ' + yb}</div>`;
    ch.stops.forEach((st) => {
      const e = st.e, i = STEPS.length;
      const next = stopsOf(SELF)[stopsOf(SELF).findIndex((x) => x.e.event_id === e.event_id) + 1];
      const toIso = next ? new Date(next.t - DAY).toISOString().slice(0, 10) : '1999-12-31';
      const u = unitOn(SELF, e.start);
      const [cc, cl] = CONF[e.confidence] || ['c-inf', e.confidence];
      const primary = e.quotes.filter((q) => !SECONDARY.has(IDX.sources[q.source_id]?.kind));
      const secondary = e.quotes.filter((q) => SECONDARY.has(IDX.sources[q.source_id]?.kind));
      const cross = (crossAt.get(e.event_id) || []);
      html += `<article class="step" data-i="${i}">
        <div class="date">${esc(e.date)}</div>
        <h3>${esc(e.detail)}</h3>
        <p class="where">${esc(place(e.place_id).name)}${u.main ? ' · ' + esc(u.main) : ''}${u.disputed.length ? ' · ' + esc(u.disputed.join(' or ')) + ' (sources disagree)' : ''}</p>
        ${cross.map((c) => crossHtml(c)).join('')}
        ${primary.map(quoteBlock).join('')}
        ${!e.quotes.length ? `<p class="note">${esc(e.note || 'No quoted source yet.')}</p>` : ''}
        ${secondary.length ? `<details class="more"><summary>More</summary>${secondary.map(quoteBlock).join('')}</details>` : ''}
        <p class="conf"><span class="${cc}">${esc(cl)}</span>${e.status === 'ai_draft' ? '<span class="c-ai">AI reading, not yet checked</span>' : ''}</p>
      </article>`;
      STEPS.push({ t: st.t, p: st.p, e, k: 0 });
    });
    html += `</section>`;
  });
  // Ending: sources and disagreements.
  const srcIds = [...new Set(doc.events.flatMap((e) => [e.source_id, ...e.quotes.map((q) => q.source_id)]).concat(doc.postings.map((p) => p.source_id)))];
  html += `<section class="end"><h2>Sources</h2><ul class="src">${srcIds.map((id) => IDX.sources[id]).filter(Boolean)
    .map((s) => `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.title)}</a>` : esc(s.title)} <span class="srcl">${esc(s.kind)}</span></li>`).join('')}</ul>`;
  if (doc.conflicts.length) html += `<h2>Where sources disagree</h2>${doc.conflicts.map((c) => `<div class="disp"><b>${esc(c.conflict_id)}</b>${esc(c.note)}</div>`).join('')}`;
  html += `<p>Built from the project's data files on ${esc(IDX.built)}. Spotted something wrong? Every stop shows the source it comes from.</p></section>`;
  $('story').innerHTML = html;
  STEPS.forEach((s, i) => { s.el = document.querySelector(`.step[data-i="${i}"]`); });
  // Zoom for each stop: wide for long moves, close for short ones.
  STEPS.forEach((s, i) => {
    const prev = STEPS[i - 1];
    const km = prev ? d3.geoDistance(prev.p, s.p) * 6371 : 600;
    s.k = Math.max(70, Math.min(5200, km * 1.5 + 40));
  });
  document.querySelectorAll('.crossgo').forEach((b) => b.addEventListener('click', () => select(b.dataset.other, curT)));
  bindGloss();
}

function crossHtml(c) {
  const other = c.soldiers.find((x) => x !== SELF), on = first(soldier(other).name);
  const title = c.human_note ? c.human_note.title : (c.tier === 'likely' ? 'within about 10 km' : 'possibly within 10 km');
  const text = c.human_note ? c.human_note.text : c.note;
  return `<aside class="cross" data-other="${other}"><div class="crossh">✦ Close by · ${esc(title)}</div><p>${esc(text)}</p>
    <button type="button" class="crossgo" data-other="${other}">See where ${esc(on)} was →</button></aside>`;
}

// ---------------- glossary tooltip ----------------
function bindGloss() {
  const tip = $('gtip');
  const show = (el) => { tip.textContent = el.dataset.g; tip.hidden = false; const r = el.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left)) + 'px'; tip.style.top = (r.bottom + 6) + 'px'; };
  document.querySelectorAll('abbr[data-g]').forEach((a) => {
    a.addEventListener('mouseenter', () => show(a)); a.addEventListener('focus', () => show(a));
    a.addEventListener('mouseleave', () => { tip.hidden = true; }); a.addEventListener('blur', () => { tip.hidden = true; });
  });
  addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
}

// ---------------- timeline (to scale) ----------------
const tlEl = $('tl');
let tlG = null;
function tlDraw() {
  if (!IDX || !SELF) return;
  const r = tlEl.getBoundingClientRect(), W2 = r.width, H2 = r.height, vert = H2 > W2;
  const top = vert ? 56 : 0, bot = vert ? H2 - 26 : W2, left = vert ? 0 : 54, right = vert ? 0 : W2 - 10;
  const pos = (t) => vert ? top + (t - Y0) / (Y1 - Y0) * (bot - top) : left + (t - Y0) / (Y1 - Y0) * (right - left);
  const ink = css('--ink'), muted = css('--muted'), route = css('--route'), rule = css('--rule'), paper = css('--paper');
  let svg = `<svg width="${W2}" height="${H2}" xmlns="http://www.w3.org/2000/svg">`;
  if (vert) svg += `<text x="6" y="16" font-size="9.5" fill="${muted}">before</text><text x="6" y="27" font-size="9.5" fill="${muted}">the war</text>`;
  const bx = vert ? 38 : 0, bw = 10;
  svg += vert ? `<rect x="${bx}" y="${pos(Y0)}" width="${bw}" height="${pos(Date.UTC(1945, 4, 8)) - pos(Y0)}" fill="${route}" opacity=".85"/>`
    + `<rect x="${bx}" y="${pos(Date.UTC(1945, 4, 8))}" width="${bw}" height="${pos(Y1) - pos(Date.UTC(1945, 4, 8))}" fill="${css('--border')}" opacity=".55"/>`
    : `<rect x="${left}" y="12" width="${pos(Date.UTC(1945, 4, 8)) - left}" height="9" fill="${route}" opacity=".85"/><rect x="${pos(Date.UTC(1945, 4, 8))}" y="12" width="${right - pos(Date.UTC(1945, 4, 8))}" height="9" fill="${css('--border')}" opacity=".55"/>`;
  for (let y = 1940; y <= 1946; y++) {
    const p = pos(Date.UTC(y, 0, 1));
    svg += vert ? `<line x1="${bx - 6}" x2="${bx}" y1="${p}" y2="${p}" stroke="${muted}"/><text x="${bx - 8}" y="${p + 4}" text-anchor="end" font-size="10" fill="${muted}">'${String(y).slice(2)}</text>`
      : `<line x1="${p}" x2="${p}" y1="21" y2="25" stroke="${muted}"/><text x="${p}" y="34" text-anchor="middle" font-size="9" fill="${muted}">${y}</text>`;
  }
  STEPS.forEach((s) => { if (s.t < Y0 || s.t > Y1) return; const p = pos(s.t);
    svg += vert ? `<line x1="${bx}" x2="${bx + bw}" y1="${p}" y2="${p}" stroke="${paper}"/>` : `<line x1="${p}" x2="${p}" y1="12" y2="21" stroke="${paper}"/>`; });
  // Birthdays, gold.
  const born = soldier(SELF).born;
  if (born) for (let y = 1940; y <= 1946; y++) { const b = Date.UTC(y, +born.slice(5, 7) - 1, +born.slice(8, 10)); const p = pos(b);
    svg += vert ? `<circle cx="${bx + bw / 2}" cy="${p}" r="3" fill="${css('--gold')}"><title>Birthday, turned ${y - +born.slice(0, 4)}</title></circle>` : `<circle cx="${p}" cy="16.5" r="2.6" fill="${css('--gold')}"/>`; }
  if (vert) svg += `<text x="${W2 / 2}" y="${H2 - 8}" text-anchor="middle" font-size="9.5" fill="${muted}">to scale</text>`;
  svg += `<circle id="tlmk" r="6" fill="${paper}" stroke="${route}" stroke-width="3"/>`
    + (vert ? `<text id="tlmkd" x="${bx + bw + 6}" font-size="9.5" fill="${route}"><tspan id="tlmkd1" x="${bx + bw + 6}"></tspan><tspan id="tlmkd2" x="${bx + bw + 6}" dy="11"></tspan></text>`
      : `<text id="tlmkd" y="8" font-size="9.5" fill="${route}" text-anchor="middle"></text>`) + `</svg>`;
  tlEl.innerHTML = svg;
  tlG = { vert, pos, bx, bw, left };
  tlG.toT = (v) => vert ? Y0 + (v - top) / (bot - top) * (Y1 - Y0) : Y0 + (v - left) / (right - left) * (Y1 - Y0);
  tlEl.querySelector('svg').addEventListener('click', (e) => {
    const rr = tlEl.getBoundingClientRect(), v = vert ? e.clientY - rr.top : e.clientX - rr.left;
    let best = 0, bd = 1e9;
    STEPS.forEach((s, i) => { const p = s.t < Y0 ? (vert ? 42 : left) : pos(Math.min(s.t, Y1)); const d = Math.abs(p - v); if (d < bd) { bd = d; best = i; } });
    seek(STEPS[best].t, true);
  });
  tlMark();
}
function tlMark() {
  const mk = document.getElementById('tlmk'); if (!mk || !tlG) return;
  const t = curT ?? STEPS[0]?.t ?? Y0;
  const p = t < Y0 ? (tlG.vert ? 42 : 12) : tlG.pos(Math.min(t, Y1));
  if (tlG.vert) { mk.setAttribute('cx', tlG.bx + tlG.bw / 2); mk.setAttribute('cy', p); } else { mk.setAttribute('cx', p); mk.setAttribute('cy', 16.5); }
  // The marker carries the exact date the reader is at.
  const d = new Date(t), dm = d.toLocaleDateString('en-CA', { timeZone: 'UTC', day: 'numeric', month: 'short' }).replace('.', ''), y = d.getUTCFullYear();
  const lab = document.getElementById('tlmkd');
  if (tlG.vert) { lab.setAttribute('y', p - 3); document.getElementById('tlmkd1').textContent = dm; document.getElementById('tlmkd2').textContent = y; }
  else { lab.setAttribute('x', Math.max(30, Math.min(tlEl.clientWidth - 30, p))); lab.textContent = `${dm} ${y}`; }
}
new ResizeObserver(() => tlDraw()).observe(tlEl);
// Mouse wheel over the timeline moves through time; dragging along it scrubs to that date.
tlEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dir = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  const t = Math.max(STEPS[0].t, Math.min(STEPS[STEPS.length - 1].t, (curT ?? Y0) + dir * 0.2 * DAY));
  seek(t);
}, { passive: false });
let tlDrag = false;
tlEl.addEventListener('pointerdown', (e) => { tlDrag = true; tlEl.setPointerCapture(e.pointerId); });
tlEl.addEventListener('pointermove', (e) => {
  if (!tlDrag || !tlG) return;
  const rr = tlEl.getBoundingClientRect(), v = tlG.vert ? e.clientY - rr.top : e.clientX - rr.left;
  seek(Math.max(STEPS[0].t, Math.min(Y1, tlG.toT(v))));
});
tlEl.addEventListener('pointerup', () => { tlDrag = false; });
tlEl.addEventListener('pointercancel', () => { tlDrag = false; });
tlEl.style.touchAction = 'none';

// ---------------- map ----------------
const canvas = $('map'), ctx = canvas.getContext('2d'), box = $('mapbox');
const proj = d3.geoOrthographic().clipAngle(90).precision(1.2), path = d3.geoPath(proj, ctx);
// The land, sea and graticule only change when the view moves, so they're drawn once into a cached canvas.
const bg = document.createElement('canvas'), bgctx = bg.getContext('2d'), bgpath = d3.geoPath(proj, bgctx);
let bgKey = '';
const grat = d3.geoGraticule10();
let PLACED = [];
const hits = (b) => PLACED.some((p) => b[0] < p[0] + p[2] && b[0] + b[2] > p[0] && b[1] < p[1] + p[3] && b[1] + b[3] > p[1]);
// Draw a map label only where it doesn't collide with something already placed. Returns false if skipped.
function label(text, x, y, font, fill, opts = {}) {
  ctx.font = font; const w = ctx.measureText(text).width, h = parseInt(font.match(/(\d+)px/)[1], 10) + 2;
  const tries = opts.tries || [[x, y]];
  for (const [tx, ty] of tries) {
    const bx = [tx - 2, ty - h + 3, w + 4, h];
    if (tx < 2 || tx + w > W - 2 || hits(bx)) continue;
    PLACED.push(bx);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 3.5; ctx.strokeStyle = C['--land'];
    ctx.strokeText(text, tx, ty); ctx.fillStyle = fill; ctx.fillText(text, tx, ty);
    return true;
  }
  return false;
}
let switching = false;

// ---------------- detailed tiled map (zoomed in) ----------------
// OpenFreeMap vector tiles (OpenStreetMap data) and Mapzen terrain on AWS, recoloured to the paper palette.
// Falls back to the globe alone if tiles can't load (no WebGL, offline, or a host that blocks other sites).
const TILE_K = 300;            // view width in km below which the tiled map is fully shown
const TILE_STYLE = window.TILE_STYLE_OVERRIDE || 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
let ML = null, mlState = 'off', tileAlpha = 0;   // off | loading | ready | failed
const tilesReady = () => mlState === 'ready';
function initTiles() {
  if (mlState !== 'off' || typeof maplibregl === 'undefined') return;
  mlState = 'loading';
  try {
    ML = new maplibregl.Map({ container: 'tiles', style: TILE_STYLE, interactive: false, attributionControl: false, fadeDuration: 0, center: view.c, zoom: 6 });
  } catch (e) { mlState = 'failed'; return; }
  const fail = setTimeout(() => { if (mlState === 'loading') { mlState = 'failed'; } }, 15000);
  ML.on('error', (e) => { if (mlState === 'loading') { clearTimeout(fail); mlState = 'failed'; draw(); } });
  ML.on('load', () => { clearTimeout(fail); restyleTiles(); mlState = 'ready'; bgKey = ''; draw(); });
}
function restyleTiles() {
  const dark = C['--paper'] && C['--paper'].toLowerCase() !== '#eceee8';
  const firstSymbol = ML.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  for (const l of ML.getStyle().layers) {
    const id = l.id;
    try {
      if (l.type === 'background') ML.setPaintProperty(id, 'background-color', C['--land']);
      else if (l.type === 'fill-extrusion' || /building|poi|aeroway|housenumber|highway-shield|road_shield|oneway/.test(id)) ML.setLayoutProperty(id, 'visibility', 'none');
      else if (l.type === 'fill') {
        const water = /water/.test(id), green = /park|wood|forest|grass|landcover|landuse/.test(id);
        ML.setPaintProperty(id, 'fill-color', water ? C['--sea'] : green ? (dark ? '#30352a' : '#dcd5bb') : C['--land']);
        ML.setPaintProperty(id, 'fill-opacity', water ? 1 : green ? 0.7 : 0.35);
        if (l.paint && 'fill-outline-color' in l.paint) ML.setPaintProperty(id, 'fill-outline-color', 'rgba(0,0,0,0)');
      } else if (l.type === 'line') {
        const water = /water|river|stream|canal/.test(id), rail = /rail|transit/.test(id), boundary = /boundary|admin/.test(id);
        ML.setPaintProperty(id, 'line-color', water ? C['--sea'] : boundary ? C['--border'] : rail ? C['--muted'] : C['--border']);
        if (/casing/.test(id)) ML.setLayoutProperty(id, 'visibility', 'none');
      } else if (l.type === 'symbol') {
        if (l.layout && l.layout['icon-image'] && !/place|label_city|label_town|label_village/.test(id)) ML.setLayoutProperty(id, 'visibility', 'none');
        if (l.layout && 'text-field' in l.layout) {
          ML.setPaintProperty(id, 'text-color', /water/.test(id) ? C['--muted'] : C['--ink']);
          ML.setPaintProperty(id, 'text-halo-color', C['--land']);
          ML.setPaintProperty(id, 'text-halo-width', 1.4);
        }
      }
    } catch (e) { /* a layer without that property: leave it */ }
  }
  if (!ML.getSource('terrain')) {
    ML.addSource('terrain', { type: 'raster-dem', tiles: [TERRAIN], tileSize: 256, maxzoom: 13, encoding: 'terrarium' });
    ML.addLayer({ id: 'hills', type: 'hillshade', source: 'terrain', paint: { 'hillshade-shadow-color': dark ? '#000000' : '#59625b', 'hillshade-highlight-color': dark ? '#3a3f35' : '#f4efe0', 'hillshade-exaggeration': 0.35 } }, firstSymbol);
  }
  addSheets();
}

// ---------------- 1944–45 map sheets ----------------
// Real wartime 1:25,000 / 1:12,500 sheets (mostly defence overprints), already georeferenced.
// Sheets sit on top of the modern map. Where a place has several editions, the one in force on the
// date being read is shown (the newest edition published on or before that date, else the first).
let sheetsOn = true, sheetKey = '';
try { sheetsOn = localStorage.getItem('sp-sheets') !== 'off'; } catch (e) { /* storage blocked */ }
// The scans carry some transparency, so each sheet sits on a plain paper-coloured backing.
const SHEET_PAPER = '#e9e2cc';
const sheetBox = (m) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[m.b[0], m.b[1]], [m.b[2], m.b[1]], [m.b[2], m.b[3]], [m.b[0], m.b[3]], [m.b[0], m.b[1]]]] } });
function addSheets() {
  if (!ML.getSource('sheet-paper')) {
    ML.addSource('sheet-paper', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    ML.addLayer({ id: 'sheet-paper', type: 'fill', source: 'sheet-paper', minzoom: 10, paint: { 'fill-color': SHEET_PAPER, 'fill-opacity': 1 } });
  }
  for (const m of IDX.sheets || []) {
    const id = 'sheet-' + m.id;
    if (ML.getSource(id)) continue;
    ML.addSource(id, { type: 'raster', scheme: 'tms', tiles: [`wt/WWIIMM${m.id}_TIFF/{z}/{x}/{y}.png`], tileSize: 256, minzoom: 8, maxzoom: 16, bounds: m.b });
    ML.addLayer({ id, type: 'raster', source: id, minzoom: 10, layout: { visibility: 'none' }, paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 } });
  }
  sheetKey = ''; syncSheets();
}
function sheetsInForce(t) {
  // Group editions by place name and pick the one in force on date t.
  const iso = t == null ? '1944-06-06' : new Date(t).toISOString().slice(0, 10), groups = {};
  for (const m of IDX.sheets || []) (groups[m.name] ||= []).push(m);
  const on = new Set();
  for (const eds of Object.values(groups)) {
    eds.sort((a, b) => a.pub.localeCompare(b.pub));
    const cur = eds.filter((m) => m.pub <= iso).pop() || eds[0];
    on.add(cur.id);
  }
  return on;
}
function syncSheets() {
  if (!tilesReady() || !IDX.sheets) return;
  const on = sheetsOn ? sheetsInForce(curT) : new Set(), key = [...on].join();
  if (key === sheetKey) return;
  sheetKey = key;
  for (const m of IDX.sheets) { const id = 'sheet-' + m.id; if (ML.getLayer(id)) ML.setLayoutProperty(id, 'visibility', on.has(m.id) ? 'visible' : 'none'); }
  ML.getSource('sheet-paper')?.setData({ type: 'FeatureCollection', features: IDX.sheets.filter((m) => on.has(m.id)).map(sheetBox) });
}
// The sheet under the centre of the view, for the credit line.
function sheetHere() {
  if (!sheetsOn || !useTiles() || tileZoom() < 10) return null;
  const on = sheetsInForce(curT), [x, y] = view.c;
  return (IDX.sheets || []).find((m) => on.has(m.id) && x >= m.b[0] && x <= m.b[2] && y >= m.b[1] && y <= m.b[3]) || null;
}
function tileZoom() {
  // Match the tiled map's scale to the globe's at the centre of the view.
  const pxPerKm = scaleFor(view.k) / 6371, lat = view.c[1] * Math.PI / 180;
  return Math.log2(40075016.686 * Math.cos(lat) * pxPerKm / (512 * 1000));
}
function syncTiles() {
  const el = document.getElementById('tiles');
  if (tileAlpha <= 0) { if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'; $('attr').hidden = true; if (view.k < TILE_K * 3) initTiles(); return; }
  el.style.visibility = 'visible'; $('attr').hidden = false;
  ML.jumpTo({ center: view.c, zoom: tileZoom() });
  syncSheets();
  const sh = sheetHere(), sa = $('sheetattr');
  if (sa) { sa.hidden = !sh; if (sh) sa.textContent = `1944 map: ${sh.name}, ${sh.scale.replace(/(\d)(?=(\d{3})+$)/g, '$1,')}, ${sh.kind.charAt(0).toLowerCase() + sh.kind.slice(1)}, ${fmtDate(Date.parse(sh.pub))}. Laurier Military History Archive / U. Waterloo / Scholars GeoPortal`; }
  const tg = $('sheettoggle'); if (tg) tg.hidden = tileZoom() < 9.5;
}
// Overlay projection: the tiled map's own once it's mostly showing, otherwise the globe.
const useTiles = () => tilesReady() && tileAlpha >= 0.5;
function P(p) { if (useTiles()) { const q = ML.project(p); return [q.x, q.y]; } return proj(p); }
function vis(p) { return useTiles() ? true : visible(p); }
const tpath = d3.geoPath(d3.geoTransform({ point(x, y) { const q = ML.project([x, y]); this.stream.point(q.x, q.y); } }), ctx);
function opath(g) { return useTiles() ? tpath(g) : path(g); }
function unproj(px, py) { if (useTiles()) { const l = ML.unproject([px, py]); return [l.lng, l.lat]; } return proj.invert([px, py]); }
let W = 0, H = 0, DPR = 1, view = { c: [-60, 50], k: 4800 }, prog = -1, anim = null, HITS = [], userView = false;
const C = {};
function readColors() { ['--sea', '--land', '--border', '--grat', '--route', '--route-soft', '--ink', '--paper', '--muted', '--gold', '--f-type', '--f-display'].forEach((k) => { C[k] = css(k); }); }
const scaleFor = (k) => { const m = Math.min(W, H); return Math.max(m * 0.46, (m / 2) / (k / 6371)); };
const visible = (p) => { const r = proj.rotate(); return d3.geoDistance(p, [-r[0], -r[1]]) < Math.PI / 2 - 0.02; };

function selfPos() {
  // Interpolate between the active stop and the next one as the reader scrolls between them.
  if (prog < 0 || !STEPS.length) return null;
  const i = Math.floor(prog), f = prog - i;
  const a = STEPS[Math.min(i, STEPS.length - 1)], b = STEPS[Math.min(i + 1, STEPS.length - 1)];
  return f > 0 && a !== b ? d3.geoInterpolate(a.p, b.p)(f) : a.p;
}

const GREY = {};
function greyFace(id) {
  const im = FACES[id]; if (!im || !im.complete || !im.naturalWidth) return null;
  if (GREY[id]) return GREY[id];
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d'); x.filter = 'grayscale(1)'; x.drawImage(im, 0, 0);
  return (GREY[id] = c);
}
function facePin(q, id, grey, text, dx = 0) {
  const r = 15, x = q[0] + dx, y = q[1] - r - 12;
  PLACED.push([x - r - 3, y - r - 3, 2 * r + 6, 2 * r + 18]);
  ctx.save();
  if (grey) ctx.globalAlpha = 0.6;
  ctx.beginPath(); ctx.moveTo(x - 6, y + r - 2); ctx.lineTo(q[0], q[1]); ctx.lineTo(x + 6, y + r - 2); ctx.closePath();
  ctx.fillStyle = grey ? C['--muted'] : C['--route']; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 7); ctx.fillStyle = grey ? C['--muted'] : C['--route']; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.clip();
  const im = FACES[id] && FACES[id].complete && FACES[id].naturalWidth ? FACES[id] : null;
  const src = grey ? greyFace(id) : im;
  if (src) { const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height, s = Math.max(2 * r / iw, 2 * r / ih);
    ctx.drawImage(src, x - iw * s / 2, y - ih * s / 2, iw * s, ih * s); }
  if (!src) { ctx.fillStyle = C['--paper']; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.fillStyle = C['--ink']; ctx.font = `600 13px ${C['--f-display']}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(first(soldier(id).name)[0], x, y); }
  ctx.restore();
  ctx.restore();
  if (text) label(text, x + r + 7, y + 4, `12px ${C['--f-type']}`, grey ? C['--muted'] : C['--ink'], { tries: [[x + r + 7, y + 4], [x - r - 7 - ctx.measureText(text).width, y + 4], [x - 20, y - r - 6]] });
}

function edgePin(from, to, id, label) {
  // The other soldier is off screen: a greyed pin on the edge, pointing his way.
  const a = P(from); if (!a) return;
  const rad = Math.PI / 180, f1 = from[1] * rad, f2 = to[1] * rad, dl = (to[0] - from[0]) * rad;
  const th = Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl));
  const ux = Math.sin(th), uy = -Math.cos(th), m = 44, cx0 = W / 2, cy0 = H / 2;
  let t = 1e9;
  if (ux > 0) t = Math.min(t, (W - m - cx0) / ux); if (ux < 0) t = Math.min(t, (m - cx0) / ux);
  if (uy > 0) t = Math.min(t, (H - 120 - cy0) / uy); if (uy < 0) t = Math.min(t, (m + 30 - cy0) / uy);
  const x = cx0 + ux * t, y = cy0 + uy * t;
  facePin([x, y + 27], id, true, '');
  ctx.save(); ctx.font = `11px ${C['--f-type']}`; ctx.fillStyle = C['--muted']; ctx.textAlign = x > W / 2 ? 'right' : 'left';
  ctx.fillText(label, x + (x > W / 2 ? -22 : 22), y + 4); ctx.restore();
}

let drawQueued = false, lastWheel = 0, settleTimer = null;
// Redraw once with fine outlines after movement stops.
function settleSoon() { clearTimeout(settleTimer); settleTimer = setTimeout(() => { if (!anim) { bgKey = ''; draw(); } }, 250); }
function draw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawNow(); }); } }
function drawNow() {
  if (!LAND || !W) return;
  proj.translate([W / 2, H / 2]).scale(scaleFor(view.k)).rotate([-view.c[0], -view.c[1]]).clipExtent([[-20, -20], [W + 20, H + 20]]);
  const key = [view.c[0].toFixed(4), view.c[1].toFixed(4), view.k.toFixed(2), W, H, DPR, C['--land']].join('|');
  if (key !== bgKey) {
    bgKey = key;
    // Coarse outlines while the camera is moving or zoomed out; fine outlines once it settles close in.
    const moving = !!anim || (drag && drag.moved) || performance.now() - lastWheel < 200;
    const g = view.k > 900 || moving ? GEO.coarse : GEO.fine;
    if (moving) settleSoon();
    if (bg.width !== canvas.width || bg.height !== canvas.height) { bg.width = canvas.width; bg.height = canvas.height; }
    const b = bgctx; b.setTransform(DPR, 0, 0, DPR, 0, 0);
    b.fillStyle = C['--paper']; b.fillRect(0, 0, W, H);
    b.beginPath(); bgpath({ type: 'Sphere' }); b.fillStyle = C['--sea']; b.fill();
    b.beginPath(); bgpath(grat); b.strokeStyle = C['--grat']; b.lineWidth = 0.7; b.stroke();
    b.beginPath(); bgpath(g.land); b.fillStyle = C['--land']; b.fill(); b.strokeStyle = C['--border']; b.lineWidth = 0.6; b.stroke();
    b.beginPath(); bgpath(g.borders); b.strokeStyle = C['--border']; b.lineWidth = 0.8; b.setLineDash([3, 3]); b.stroke(); b.setLineDash([]);
  }
  // Zoomed in, the detailed tiled map fades in underneath; the globe background fades out over it.
  tileAlpha = tilesReady() ? Math.max(0, Math.min(1, (TILE_K + 150 - view.k) / 150)) : 0;
  syncTiles();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (tileAlpha < 1) { ctx.globalAlpha = 1 - tileAlpha; ctx.drawImage(bg, 0, 0); ctx.globalAlpha = 1; }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); HITS = []; PLACED = [];
  if (!STEPS.length) return;
  // Route: whole path faint and dashed; travelled part solid red.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); opath({ type: 'LineString', coordinates: STEPS.map((s) => s.p) }); ctx.strokeStyle = C['--route-soft']; ctx.lineWidth = 1.5; ctx.setLineDash([2, 5]); ctx.stroke(); ctx.setLineDash([]);
  const me = selfPos();
  if (prog >= 0) {
    const whole = Math.floor(prog), coords = STEPS.slice(0, whole + 1).map((s) => s.p);
    if (me) coords.push(me);
    ctx.beginPath(); opath({ type: 'LineString', coordinates: coords }); ctx.strokeStyle = C['--route']; ctx.lineWidth = 2.6; ctx.stroke();
    const seen = new Set();
    for (let i = 0; i <= Math.min(whole, STEPS.length - 1); i++) {
      const s = STEPS[i]; if (seen.has(s.e.place_id) && i !== whole) continue; seen.add(s.e.place_id);
      const q = P(s.p); if (!q || !vis(s.p)) continue;
      ctx.beginPath(); ctx.arc(q[0], q[1], i === whole ? 5 : 3, 0, 7); ctx.fillStyle = i === whole ? C['--route'] : C['--paper']; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = C['--route']; ctx.stroke();
    }
  }
  // Landmarks: ◆ battles and ✚ memorials, once zoomed in far enough. Their labels go last, where there's room.
  const lmLabels = [];
  for (const l of IDX.landmarks || []) {
    if (view.k > l.maxKm) continue;
    const p = [l.lon, l.lat], q = P(p); if (!q || !vis(p) || q[0] < 0 || q[0] > W || q[1] < 0 || q[1] > H) continue;
    HITS.push({ x: q[0], y: q[1], l });
    ctx.save(); ctx.translate(q[0], q[1]);
    if (l.kind === 'battle') { ctx.rotate(Math.PI / 4); ctx.fillStyle = C['--paper']; ctx.strokeStyle = C['--ink']; ctx.lineWidth = 1.4; ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); }
    else { ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fillStyle = C['--paper']; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = C['--muted']; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -3.6); ctx.lineTo(0, 3.6); ctx.moveTo(-2.6, -1.2); ctx.lineTo(2.6, -1.2); ctx.lineWidth = 1.5; ctx.strokeStyle = C['--ink']; ctx.stroke(); }
    ctx.restore();
    if (view.k <= 160 || (l.kind === 'battle' && view.k <= 300)) lmLabels.push({ l, q });
  }
  // Other soldiers, greyed, at the same date.
  const others = [], greyPins = [];
  if (showOthers && curT != null && me) for (const o of IDX.soldiers) {
    if (o.id === SELF) continue;
    const at = positionAt(o.id, curT); if (!at) continue;
    const km = Math.round(d3.geoDistance(me, at.p) * 6371);
    others.push({ o, at, km });
    const q = P(at.p), lab = `${first(o.name)}, ${ageAt(o.id, curT)}${bdayNear(o.id, curT) ? ' 🎂' : ''}`;
    if (q && vis(at.p) && q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H) greyPins.push({ q, id: o.id, text: lab });
    else edgePin(me, at.p, o.id, `${first(o.name)}: ${at.name}, ${km.toLocaleString()} km`);
  }
  const meQ = me && P(me);
  if (meQ && vis(me)) facePin(meQ, SELF, false, `${first(soldier(SELF).name)}, ${ageAt(SELF, curT ?? STEPS[0].t)}${bdayNear(SELF, curT ?? 0) ? ' 🎂' : ''}`);
  for (const f of greyPins) facePin(f.q, f.id, true, f.text, meQ && Math.hypot(f.q[0] - meQ[0], f.q[1] - meQ[1]) < 40 ? -40 : 0);
  // Current place: name and its written date, then landmark names where there's room.
  if (active >= 0) {
    const s = STEPS[active], q = P(s.p);
    if (q && vis(s.p)) {
      const t = IDX.places[s.e.place_id].name;
      const placed = label(t, q[0] + 10, q[1] + 20, `15px ${C['--f-type']}`, C['--route'], { tries: [[q[0] + 10, q[1] + 20], [q[0] - 10 - t.length * 8, q[1] + 20], [q[0] + 10, q[1] - 40]] });
      if (placed) { const b = PLACED[PLACED.length - 1]; label(s.e.date, b[0] + 2, b[1] + b[3] + 12, `12px ${C['--f-type']}`, C['--muted']); }
    }
  }
  for (const { l, q } of lmLabels) label(l.name, q[0] + 9, q[1] + 4, `italic 11px ${C['--f-type']}`, C['--ink'], { tries: [[q[0] + 9, q[1] + 4], [q[0] - 9 - l.name.length * 6.2, q[1] + 4], [q[0] - l.name.length * 3, q[1] + 18]] });
  // Close by: a gold dashed ring around both pins.
  const ep = curT != null && CLOSE.find((c) => c.soldiers.includes(SELF) && ms(c.from) <= curT && curT <= ms(c.to) + DAY && (c.human_note || c.tier !== 'possibly'));
  if (ep && me && showOthers) {
    const other = ep.soldiers.find((x) => x !== SELF), at = positionAt(other, curT);
    const a = P(me), b = at && P(at.p);
    if (a && b) { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2 - 24, rr = Math.max(48, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 + 36);
      if (rr < Math.min(W, H) * 0.45) { ctx.save(); ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeStyle = C['--gold']; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore(); label('✦ Close by', cx - 36, cy + rr + 16, `600 12px ${C['--f-type']}`, C['--gold'], { tries: [[cx - 36, cy + rr + 16], [cx - 36, cy - rr - 6]] }); } }
  }
  $('capOther').textContent = others.length ? others.map(({ o, at, km }) => `${first(o.name)}: ${at.name}, ${km < 5 ? 'same place' : 'about ' + km.toLocaleString() + ' km away'}`).join(' · ') : '';
  updateScale();
}

function updateScale() {
  const pxPerKm = proj.scale() / 6371, nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  let km = nice[0]; for (const v of nice) if (v * pxPerKm <= Math.min(110, W * 0.25)) km = v;
  $('scaleTxt').textContent = km >= 1000 ? `${km.toLocaleString()} km` : `${km} km`;
  $('scaleBar').style.width = Math.max(20, km * pxPerKm) + 'px';
}
function resize() {
  const r = box.getBoundingClientRect(); W = r.width; H = r.height; DPR = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  if (ML) ML.resize();
  draw();
}

// Ages and birthdays, from the birth date.
function ageAt(id, t) { const b = soldier(id).born; if (!b) return ''; const d = new Date(t), y = d.getUTCFullYear() - +b.slice(0, 4);
  return (d.getUTCMonth() + 1 < +b.slice(5, 7) || (d.getUTCMonth() + 1 === +b.slice(5, 7) && d.getUTCDate() < +b.slice(8, 10))) ? y - 1 : y; }
function bdayNear(id, t) { const b = soldier(id).born; if (!b || t == null) return false; const y = new Date(t).getUTCFullYear(); return Math.abs(Date.UTC(y, +b.slice(5, 7) - 1, +b.slice(8, 10)) - t) < 4 * DAY; }

// ---------------- moving between stops ----------------
function go(i) {
  if (i === active) return;
  active = i; hidePop(); userView = false; $('mreset').hidden = true;
  STEPS.forEach((s, j) => s.el.classList.toggle('on', j === i));
  const s = STEPS[i] || null;
  const target = s ? { c: s.p, k: s.k, p: i } : { c: [-60, 50], k: 4800, p: -1 };
  const from = { c: view.c.slice(), k: view.k, p: prog };
  // After a tab switch the route belongs to a different soldier: show it up to his stop at once, only the view moves.
  if (switching) { from.p = target.p; prog = target.p; switching = false; }
  if (anim) anim.stop();
  if (reduce) { view = { c: target.c, k: target.k }; prog = target.p; draw(); return; }
  const ic = d3.geoInterpolate(from.c, target.c), dist = d3.geoDistance(from.c, target.c);
  const peak = Math.max(from.k, target.k, dist * 6371 * 0.6);
  const dur = Math.min(2400, 700 + dist * 6371 * 0.35 + Math.abs(Math.log(target.k / from.k)) * 120);
  const dp = target.p - from.p;
  anim = d3.timer((el) => {
    const t = Math.min(1, el / dur), e = d3.easeCubicInOut(t);
    view.c = ic(e);
    const lk = Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e;
    const bump = Math.sin(Math.PI * e) * Math.max(0, Math.log(peak) - Math.max(Math.log(from.k), Math.log(target.k)));
    view.k = Math.exp(lk + bump);
    prog = dp >= 0 ? from.p + dp * e : target.p;
    if (t >= 1) { anim.stop(); anim = null; prog = target.p; }
    draw();
  });
}

function lineY() { return innerWidth < 900 ? tlEl.getBoundingClientRect().bottom + innerHeight * 0.1 : innerHeight * 0.45; }
function onScroll() {
  if (!STEPS.length) return;
  const line = lineY();
  let idx = -1;
  STEPS.forEach((s, i) => { if (s.el.getBoundingClientRect().top < line) idx = i; });
  if (idx < 0) curT = null;
  else {
    const a = STEPS[idx], b = STEPS[idx + 1], ta = a.el.getBoundingClientRect().top;
    if (!b) curT = a.t; else { const tb = b.el.getBoundingClientRect().top; const f = Math.max(0, Math.min(1, (line - ta) / ((tb - ta) || 1))); curT = a.t + f * (b.t - a.t);
      // Between two stops the pin travels along the route as the reader scrolls.
      if (idx === active && !anim && !userView) prog = idx + Math.min(f, 0.999); }
  }
  if (window.__pinT != null && curT != null && Math.abs(curT - window.__pinT) < DAY) curT = window.__pinT; else window.__pinT = null;
  go(idx);
  const s = STEPS[idx];
  $('capDate').textContent = curT != null ? fmtDate(curT) : (STEPS[0] ? 'Before ' + fmtDate(STEPS[0].t) : '');
  $('capAge').textContent = curT != null ? ` · age ${ageAt(SELF, curT)}${bdayNear(SELF, curT) ? ' 🎂' : ''}` : '';
  $('capPlace').textContent = s ? IDX.places[s.e.place_id].name : soldier(SELF).name;
  tlMark();
  if (!anim) draw();
}
function seek(t, smooth) {
  // Scroll the story so the reading line sits at date t (used by the timeline and when switching soldiers).
  window.__pinT = t;
  let i = -1; STEPS.forEach((x, k) => { if (x.t <= t + 1e-6) i = k; });
  if (i < 0) { scrollTo({ top: 0, behavior: smooth && !reduce ? 'smooth' : 'auto' }); return; }
  const a = STEPS[i], b = STEPS[i + 1], ya = a.el.getBoundingClientRect().top + scrollY;
  let y = ya;
  if (b && b.t > a.t) { const yb = b.el.getBoundingClientRect().top + scrollY; y = ya + Math.min(1, (t - a.t) / (b.t - a.t)) * (yb - ya); }
  const frac = b && b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;
  scrollTo({ top: Math.round(y - lineY() + 1), behavior: smooth && !reduce ? 'smooth' : 'auto' });
  if (!smooth || reduce) {
    // Sticky panels can shift the page slightly after a jump; measure again and correct.
    for (let k = 0; k < 2; k++) {
      const ta = a.el.getBoundingClientRect().top, tb = b ? b.el.getBoundingClientRect().top : ta;
      const want = ta + frac * (tb - ta), err = want - (lineY() - 1);
      if (Math.abs(err) < 1) break;
      scrollBy(0, Math.round(err));
    }
  }
  onScroll();
}

let ticking = false;
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; onScroll(); }); } }, { passive: true });

// ---------------- map interaction ----------------
const pop = $('pop');
function hidePop() { pop.hidden = true; }
$('popx').addEventListener('click', hidePop);
function hitAt(e) { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 18;
  HITS.forEach((h) => { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }); return best; }
let drag = null;
const touches = new Map();
let pinch = null;
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }; drag = null; return; }
  drag = { x: e.clientX, y: e.clientY, c: view.c.slice(), moved: false }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); pinch = null; drag = null; });
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (anim) { anim.stop(); anim = null; } lastWheel = performance.now();
    view.k = Math.max(20, Math.min(9000, pinch.k * pinch.d / Math.max(10, d))); userView = true; $('mreset').hidden = false; draw(); return;
  }
  if (!drag) { canvas.style.cursor = hitAt(e) ? 'pointer' : ''; return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  const deg = 180 / Math.PI / proj.scale();
  view.c = [drag.c[0] - dx * deg / Math.cos(view.c[1] * Math.PI / 180), Math.max(-80, Math.min(80, drag.c[1] + dy * deg))];
  // (scales match at the centre, so the same pan works for the tiled map)
  userView = true; $('mreset').hidden = false; if (anim) { anim.stop(); anim = null; } draw();
});
canvas.addEventListener('pointerup', (e) => {
  touches.delete(e.pointerId); if (pinch) { if (touches.size < 2) pinch = null; return; }
  const d = drag; drag = null; if (d && d.moved) { settleSoon(); return; }
  const h = hitAt(e); if (!h) { hidePop(); return; }
  $('popt').textContent = h.l.name; $('popd').textContent = h.l.d || '';
  pop.hidden = false; const pw = pop.offsetWidth, ph = pop.offsetHeight; let x = h.x + 14, y = h.y - ph / 2;
  if (x + pw > W - 8) x = h.x - 14 - pw; pop.style.left = Math.max(8, x) + 'px'; pop.style.top = Math.max(8, Math.min(H - ph - 8, y)) + 'px';
});
// Zoom by factor f, keeping the point under (px, py) fixed when given.
function zoomBy(f, px, py) {
  if (anim) { anim.stop(); anim = null; }
  const before = px != null ? unproj(px, py) : null;
  view.k = Math.max(20, Math.min(9000, view.k * f));
  if (before) {
    proj.scale(scaleFor(view.k));
    if (useTiles()) ML.jumpTo({ center: view.c, zoom: tileZoom() });
    const after = unproj(px, py);
    if (after && isFinite(after[0])) view.c = [view.c[0] + before[0] - after[0], Math.max(-80, Math.min(80, view.c[1] + before[1] - after[1]))];
  }
  userView = true; $('mreset').hidden = false; draw();
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); lastWheel = performance.now();
  const r = canvas.getBoundingClientRect();
  zoomBy(Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015))), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
canvas.addEventListener('dblclick', (e) => { const r = canvas.getBoundingClientRect(); zoomBy(0.5, e.clientX - r.left, e.clientY - r.top); });
{ const tg = $('sheettoggle'); tg.setAttribute('aria-pressed', String(sheetsOn));
  tg.addEventListener('click', () => { sheetsOn = !sheetsOn; tg.setAttribute('aria-pressed', String(sheetsOn)); try { localStorage.setItem('sp-sheets', sheetsOn ? 'on' : 'off'); } catch (e) { /* storage blocked */ } sheetKey = ''; draw(); }); }
$('zin').addEventListener('click', () => { lastWheel = performance.now(); zoomBy(0.6); });
$('zout').addEventListener('click', () => { lastWheel = performance.now(); zoomBy(1 / 0.6); });
$('mreset').addEventListener('click', () => { const i = active; active = -3; go(i); });

new ResizeObserver(() => { resize(); onScroll(); }).observe(box);
const recolor = () => { readColors(); bgKey = ''; if (tilesReady()) restyleTiles(); tlDraw(); draw(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', recolor);
readColors();
document.fonts && document.fonts.ready.then(() => draw());
boot().then(() => { resize(); onScroll(); });
