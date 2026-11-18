// Same-origin proxy for the georeferenced 1944–45 map sheets served by Scholars GeoPortal
// (scanned by the Laurier Military History Archive, georeferenced at the University of Waterloo).
// Their tile host doesn't send CORS headers, which the WebGL map needs. Tiles are cached at Cloudflare's edge.
export async function onRequestGet(context) {
  const p = (context.params.path || []).join('/');
  if (!/^WWIIMM\w+_TIFF\/\d{1,2}\/\d+\/\d+\.png$/.test(p)) return new Response('not found', { status: 404 });
  const cache = caches.default;
  const hit = await cache.match(context.request);
  if (hit) return hit;
  const up = await fetch('https://images.scholarsportal.info/web-tiles/' + p, { cf: { cacheTtl: 2592000, cacheEverything: true } });
  const res = new Response(up.ok ? up.body : null, {
    status: up.ok ? 200 : 404,
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=2592000', 'access-control-allow-origin': '*' },
  });
  if (up.ok) context.waitUntil(cache.put(context.request, res.clone()));
  return res;
}
