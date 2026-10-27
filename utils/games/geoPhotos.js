'use strict';
// Finds a photo for a round. Providers are tried in order until one returns pictures:
//   1. mapillary  — real street-level photos (needs the free MAPILLARY_TOKEN; skipped without it)
//   2. wikimedia  — geotagged photos from Wikimedia Commons (no key, very reliable; landmarks & streets)
// A provider that keeps failing is parked for a few minutes so rounds don't wait on its timeouts.

const cfg = require('./config.js');
const net = require('./geoNet.js');
const { COUNTRIES } = require('./countries.js');
const { GEO } = require('./geoPoints.js');

const g = () => cfg.geo;

// Trim spaces/newlines and one pair of quotes that sometimes get pasted along with the token.
const tidy = (v) => String(v || '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const mapillaryToken = () => tidy(process.env.MAPILLARY_TOKEN) || tidy(g().mapillaryToken);

// ── Mapillary ────────────────────────────────────────────────────────────────
const MLY = 'https://graph.mapillary.com/images';

/** bbox = [minLon, minLat, maxLon, maxLat] around a point, with a jitter so rounds differ. */
function bboxAround([lat, lon], rng = Math.random) {
  const jl = (rng() * 2 - 1) * g().jitterDeg, jo = (rng() * 2 - 1) * g().jitterDeg;
  const cy = lat + jl, cx = lon + jo, h = g().bboxHalfDeg;
  const r = (n) => Number(n.toFixed(5));
  return [r(cx - h), r(cy - h), r(cx + h), r(cy + h)];
}

function buildUrl(tok, bbox) {
  const q = new URLSearchParams({
    access_token: tok,
    bbox: bbox.join(','),
    fields: 'id,thumb_1024_url,computed_geometry,captured_at',
    is_pano: 'false',
    limit: String(g().limit),
  });
  return `${MLY}?${q.toString()}`;
}

async function mapillaryQuery(point, rng) {
  const bbox = bboxAround(point, rng);
  const t0 = Date.now();
  let res;
  try { res = await net.get(buildUrl(mapillaryToken(), bbox), { timeoutMs: g().httpTimeoutMs }); }
  catch (err) { throw new Error(`${err.message} (after ${Date.now() - t0} ms, bbox ${bbox.map(n => n.toFixed(3)).join(',')})`); }
  if (!res || !res.ok) throw new Error(`HTTP ${res && res.status} (${Date.now() - t0} ms)`);
  const body = await res.json();
  if (body && body.error) throw new Error(body.error.message || 'API error');
  return (body && body.data ? body.data : [])
    .filter(im => im && im.id && im.thumb_1024_url)
    .map(im => {
      const c = im.computed_geometry && im.computed_geometry.coordinates;
      return { id: String(im.id), url: im.thumb_1024_url, lon: c ? c[0] : null, lat: c ? c[1] : null, source: 'mapillary' };
    });
}

// ── Wikimedia Commons ────────────────────────────────────────────────────────
const WIKI = 'https://commons.wikimedia.org/w/api.php';
// Files that are not real photographs of a place.
const NOT_A_PHOTO = /(\bmap\b|locator|flag|logo|coat[ _]of[ _]arms|diagram|plan\b|poster|stamp|banknote|coin|seal|icon|signature|chart|panorama of the interior|\binterior\b|portrait|\.svg|\.gif|\.pdf|\.tif|\.ogg|\.webm)/i;

function wikiUrl(lat, lon) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    generator: 'geosearch', ggscoord: `${lat}|${lon}`, ggsradius: String(g().wikiRadiusM), ggsnamespace: '6', ggslimit: '40',
    prop: 'coordinates|imageinfo', colimit: '40', iiprop: 'url|mime|size', iiurlwidth: '1024',
  });
  return `${WIKI}?${q.toString()}`;
}

async function wikimediaQuery(point, rng) {
  const jl = (rng() * 2 - 1) * g().jitterDeg, jo = (rng() * 2 - 1) * g().jitterDeg;
  const lat = Number((point[0] + jl).toFixed(5)), lon = Number((point[1] + jo).toFixed(5));
  const t0 = Date.now();
  const res = await net.get(wikiUrl(lat, lon), { timeoutMs: g().httpTimeoutMs });
  if (!res || !res.ok) throw new Error(`HTTP ${res && res.status} (${Date.now() - t0} ms)`);
  const body = await res.json();
  if (body && body.error) throw new Error(body.error.info || 'API error');
  const pages = (body && body.query && body.query.pages) || [];
  const out = [];
  for (const p of pages) {
    const ii = p.imageinfo && p.imageinfo[0];
    const co = p.coordinates && p.coordinates[0];
    if (!ii || !co || !ii.thumburl) continue;
    if (ii.mime !== 'image/jpeg') continue;
    if (ii.width < 800 || ii.height < 500) continue;
    if (NOT_A_PHOTO.test(p.title || '')) continue;
    out.push({
      id: String(p.pageid), url: ii.thumburl, lat: co.lat, lon: co.lon, source: 'wikimedia',
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(p.title).replace(/ /g, '_')).replace(/%3A/gi, ':')}`,
    });
  }
  return out;
}

const PROVIDERS = {
  mapillary: { name: 'Mapillary', credit: '📷 Mapillary (CC-BY-SA)', enabled: () => !!mapillaryToken(), query: mapillaryQuery },
  wikimedia: { name: 'Wikimedia Commons', credit: '📷 Wikimedia Commons (CC)', enabled: () => true, query: wikimediaQuery },
};

// A provider with N errors in a row is parked, so a down API doesn't slow every round.
const health = new Map();   // key → { fails, parkedUntil }
function parked(key, now = Date.now()) { const h = health.get(key); return !!(h && h.parkedUntil > now); }
function noteOk(key) { health.delete(key); }
function noteFail(key, now = Date.now()) {
  const h = health.get(key) || { fails: 0, parkedUntil: 0 };
  h.fails++;
  if (h.fails >= g().parkAfterFails) { h.parkedUntil = now + g().parkMs; h.fails = 0; }
  health.set(key, h);
}
function resetHealth() { health.clear(); }

const providerList = () => (g().providers || ['mapillary', 'wikimedia']).filter(k => PROVIDERS[k] && PROVIDERS[k].enabled());
const isConfigured = () => providerList().length > 0;

function weightedPick(list, rng) {
  const total = list.reduce((a, c) => a + c.w, 0);
  let x = rng() * total;
  for (const c of list) { if (x < c.w) return c; x -= c.w; }
  return list[list.length - 1];
}

/**
 * Up to g().attempts tries: each picks a (weighted) country not used yet, one of its points, and asks
 * the providers in order. Returns { country, image:{id,url,lat,lon,source,page?}, credit } or null.
 */
async function findPhoto({ used = new Set(), rng = Math.random } = {}) {
  const pool = COUNTRIES.filter(c => GEO[c.code] && !used.has(c.code)).map(c => ({ c, w: GEO[c.code].weight }));
  const tried = new Set();
  for (let a = 0; a < g().attempts && pool.length; a++) {
    const live = pool.filter(p => !tried.has(p.c.code));
    if (!live.length) break;
    const p = weightedPick(live, rng);
    tried.add(p.c.code);
    const pts = GEO[p.c.code].points;
    const point = pts[Math.floor(rng() * pts.length)];

    for (const key of providerList()) {
      if (parked(key)) continue;
      let images = [];
      try { images = await PROVIDERS[key].query(point, rng); noteOk(key); }
      catch (err) { noteFail(key); console.error(`[Geo] ${PROVIDERS[key].name} query failed:`, err.message); continue; }
      if (!images.length) continue;
      const im = images[Math.floor(rng() * images.length)];
      return { country: p.c, image: im, credit: PROVIDERS[key].credit };
    }
  }
  return null;
}

module.exports = { findPhoto, buildUrl, bboxAround, mapillaryQuery, wikimediaQuery, wikiUrl, isConfigured, providerList, resetHealth, PROVIDERS, parked };
