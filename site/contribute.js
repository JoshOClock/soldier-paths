// Contribute page: show the prompt, check what the person's AI produced, preview it, and help them send it.
import { parseDate } from './data/lib/dates.mjs';
import { extractJson, validate } from './submit/check.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REPO = 'JoshOClock/soldier-paths';
// Where emailed submissions go. Empty hides the email button.
const SUBMIT_EMAIL = '';
let current = null;

fetch('submit/prompt.md').then((r) => r.text()).then((t) => { $('prompt').textContent = t; });

$('copyPrompt').addEventListener('click', async () => {
  await copy($('prompt').textContent);
  flash($('copyPrompt'), 'Copied');
});
$('example').addEventListener('click', async () => {
  $('paste').value = await (await fetch('submit/example.json')).text();
  check();
});
$('check').addEventListener('click', check);
for (const id of ['ok1', 'ok2']) $(id).addEventListener('change', gate);

function check() {
  const out = $('result');
  let s;
  try { s = extractJson($('paste').value); } catch (e) {
    current = null; gate(); $('sendStep').hidden = true;
    out.innerHTML = `<p class="verdict bad">That doesn't look like the AI's JSON answer. Make sure you pasted its whole reply, including the part that starts with { and ends with }.</p>`;
    return;
  }
  const { errors, warnings, stops } = validate(s, parseDate);
  current = errors.length ? null : s;
  const list = (arr, cls) => arr.length ? `<ul class="msgs">${arr.map((m) => `<li class="${cls}">${esc(m)}</li>`).join('')}</ul>` : '';
  const verdict = errors.length
    ? `<p class="verdict bad">${errors.length} thing${errors.length > 1 ? 's' : ''} to fix before this can be sent. You can ask your AI to fix them: paste the list back to it.</p>`
    : `<p class="verdict">Looks good. ${stops.length} stop${stops.length === 1 ? '' : 's'}${warnings.length ? `, and ${warnings.length} thing${warnings.length > 1 ? 's' : ''} worth a look` : ''}.</p>`;
  out.innerHTML = verdict + list(errors, 'err') + list(warnings, '') + preview(s, stops);
  drawMap(stops);
  $('sendStep').hidden = !current;
  gate();
}

function photosFor(s, n) {
  const ph = (s.photos || []).filter((p) => p.event === n);
  return ph.length ? `<br>📷 ${ph.map((p) => esc(p.file)).join(', ')}` : '';
}
function preview(s, stops) {
  const so = s.soldier || {};
  const units = (s.units || []).map((u) => u.name).filter(Boolean);
  const src = Object.fromEntries((s.sources || []).map((x) => [x.id, x]));
  const conf = { documented: 'documented', family: 'family record', estimated: 'estimated' };
  return `<div class="pv"><div><svg id="pvmap" viewBox="0 0 480 360" role="img" aria-label="Preview of the route"></svg></div><div>
    <h3>${esc(so.name || 'No name')}</h3>
    <p class="meta">${[so.rank, so.service_number, so.born?.date && `born ${so.born.date}${so.born.place ? ', ' + so.born.place : ''}`].filter(Boolean).map(esc).join(' · ')}${units.length ? '<br>' + units.map(esc).join(' → ') : ''}</p>
    <ol>${stops.map((e) => `<li><span class="d">${esc(e.date)}</span>${esc(e.what)} <i>${esc(e.place?.name)}</i><br><span class="c">${esc(conf[e.confidence] || e.confidence || '')}${src[e.source] ? ' · ' + esc(src[e.source].title) : ''}${photosFor(s, e._i + 1)}</span></li>`).join('')}</ol>
    ${(s.photos || []).length ? `<p class="meta">Photos to send with it: ${(s.photos || []).map((p) => esc(p.file)).join(', ')}</p>` : ''}
  </div></div>`;
}

let LAND = null;
async function drawMap(stops) {
  const svg = d3.select('#pvmap'); if (svg.empty()) return;
  const pts = stops.filter((e) => typeof e.place?.lon === 'number' && typeof e.place?.lat === 'number');
  if (!LAND) { const w = await (await fetch('data/vendor/countries-110m.json')).json(); LAND = topojson.feature(w, w.objects.countries); }
  const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
  const line = { type: 'LineString', coordinates: pts.map((e) => [e.place.lon, e.place.lat]) };
  const fit = pts.length > 1 ? line : { type: 'Point', coordinates: pts[0] ? [pts[0].place.lon, pts[0].place.lat] : [-40, 50] };
  const proj = d3.geoMercator();
  if (pts.length > 1) proj.fitExtent([[30, 30], [450, 330]], line); else proj.center(fit.coordinates).scale(600).translate([240, 180]);
  const path = d3.geoPath(proj);
  svg.selectAll('*').remove();
  svg.append('path').attr('d', path(LAND)).attr('fill', css('--land')).attr('stroke', css('--border')).attr('stroke-width', 0.6);
  if (pts.length > 1) svg.append('path').attr('d', path(line)).attr('fill', 'none').attr('stroke', css('--route')).attr('stroke-width', 2);
  pts.forEach((e, i) => {
    const [x, y] = proj([e.place.lon, e.place.lat]);
    svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 3.5).attr('fill', css('--paper')).attr('stroke', css('--route')).attr('stroke-width', 1.6)
      .append('title').text(`${e.date}: ${e.place.name}`);
    if (i === 0 || i === pts.length - 1) svg.append('text').attr('x', x > 360 ? x - 6 : x + 6).attr('text-anchor', x > 360 ? 'end' : 'start').attr('y', y - 6).attr('font-family', css('--f-type')).attr('font-size', 11).attr('fill', css('--ink')).text(e.place.name);
  });
}

function gate() {
  const ok = !!current && $('ok1').checked && $('ok2').checked;
  $('download').disabled = !ok; $('github').disabled = !ok; if ($('email')) $('email').disabled = !ok;
  const ph = (current?.photos || []).map((p) => p.file);
  $('sendNote').innerHTML = current ? `Your code is <b>${esc(code())}</b>. ${ph.length ? `Attach the file and these ${ph.length} photo${ph.length > 1 ? 's' : ''}: ${ph.map(esc).join(', ')}.` : 'Attach the file, and any photos.'}` : '';
}
// A short code ties the file to the email and photos sent with it.
function code() {
  if (!current) return '';
  if (!current.submission_code) {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(5));
    current.submission_code = 'SP-' + [...r].map((x) => a[x % a.length]).join('');
  }
  return current.submission_code;
}
function fileText() {
  code();
  return JSON.stringify({ ...current, submitted_at: new Date().toISOString().slice(0, 10) }, null, 2);
}
function fileName() {
  const n = (current.soldier?.name || 'soldier').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${n}-${code()}.soldier.json`;
}
$('download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([fileText()], { type: 'application/json' }));
  a.download = fileName(); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
if (SUBMIT_EMAIL) $('email').hidden = false;
$('email')?.addEventListener('click', () => {
  // Download the file first, then open an email with the code in the subject; the person attaches the file and photos.
  $('download').click();
  const name = current.soldier?.name || 'a soldier';
  const photos = (current.photos || []).map((p) => `- ${p.file}: ${p.caption || ''}`).join('\n');
  const body = `Soldier: ${name}\nCode: ${code()}\nFrom: ${current.submitted_by?.name || ''} (${current.submitted_by?.relationship || ''})\n\nAttached: ${fileName()}${photos ? '\n\nPhotos attached:\n' + photos : ''}\n\n(Please attach the downloaded file and the photos before sending.)`;
  location.href = `mailto:${SUBMIT_EMAIL}?subject=${encodeURIComponent(`Soldier Paths: ${name} [${code()}]`)}&body=${encodeURIComponent(body)}`;
});
$('github').addEventListener('click', async () => {
  await copy(fileText());
  flash($('github'), 'Copied. Paste it into the form');
  const title = encodeURIComponent(`Soldier: ${current.soldier?.name || ''}`);
  window.open(`https://github.com/${REPO}/issues/new?template=soldier.yml&title=${title}`, '_blank', 'noopener');
});

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch (e) {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
}
function flash(btn, msg) { const old = btn.textContent; btn.textContent = msg; setTimeout(() => { btn.textContent = old; }, 2200); }
