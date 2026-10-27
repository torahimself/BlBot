'use strict';
// Turns what a player typed («باريس», «Tokyo», «شارع التحلية جدة», «فرنسا») into a map point.
//   1. countries and capitals — offline, instant (Arabic / English / aliases)
//   2. Open-Meteo geocoding   — free, no key, understands Arabic place names (cities, towns, regions)
//   3. Nominatim (OpenStreetMap) — free, no key, finds streets and landmarks (1 request/second, queued)
// Results are cached. Anything that is not a place simply returns null.

const cfg = require('./config.js');
const net = require('./geoNet.js');
const { normalize } = require('./arabic.js');
const { isLaughter, isJunk, collapse } = require('../economy/engine/textFilter.js');
const { COUNTRIES, matches } = require('./countries.js');
const { GEO } = require('./geoPoints.js');

const g = () => cfg.geo;

const CACHE_MAX = 1500;
const cache = new Map();    // key → result | null
function remember(key, v) {
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return v;
}

/** Cleans chat text into a query, or '' if it can't be a place name. */
function toQuery(text) {
  let t = String(text == null ? '' : text).replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, ' ').replace(/[`*_~|"“”«»]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 60) return '';
  if (!/\p{L}/u.test(t)) return '';
  if (/\d{4,}/.test(t)) return '';
  if (t.split(' ').length > 6) return '';
  const flat = collapse(t.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());
  if (isLaughter(flat) || isJunk(flat)) return '';
  return t;
}

const capKeys = new Map();   // normalized capital name → country
for (const c of COUNTRIES) { capKeys.set(normalize(c.capAr), c); capKeys.set(normalize(c.capEn), c); }

/** Offline: a country name, or a capital. */
function fromCountries(q) {
  const n = normalize(q);
  if (!n) return null;
  const cap = capKeys.get(n);
  if (cap && GEO[cap.code]) {
    const [lat, lon] = GEO[cap.code].points[0];
    const ar = /[\u0600-\u06FF]/.test(q);
    return { lat, lon, label: ar ? `${cap.capAr}، ${cap.ar}` : `${cap.capEn}, ${cap.en}`, kind: 'capital', country: cap.code, source: 'offline' };
  }
  for (const c of COUNTRIES) {
    if (GEO[c.code] && matches(c, q)) {
      const [lat, lon] = GEO[c.code].points[0];
      return { lat, lon, label: `${c.ar} ${c.flag}`, kind: 'country', country: c.code, source: 'offline' };
    }
  }
  return null;
}

async function openMeteo(q) {
  const lang = /[؀-ۿ]/.test(q) ? 'ar' : 'en';
  const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '5', language: lang, format: 'json' })}`;
  const res = await net.get(url, { timeoutMs: g().geocodeTimeoutMs });
  if (!res || !res.ok) throw new Error(`Open-Meteo HTTP ${res && res.status}`);
  const body = await res.json();
  const list = (body && body.results) || [];
  if (!list.length) return null;
  // The API ranks by relevance; among near-equal names prefer the bigger place.
  const first = list[0];
  const best = list.filter(r => r.name === first.name).sort((a, b) => (b.population || 0) - (a.population || 0))[0] || first;
  if (!Number.isFinite(best.latitude) || !Number.isFinite(best.longitude)) return null;
  const label = [best.name, best.country].filter(Boolean).join('، ');
  return { lat: best.latitude, lon: best.longitude, label, kind: 'place', country: best.country_code || null, source: 'open-meteo' };
}

// Nominatim allows 1 request per second: a tiny queue.
let nomChain = Promise.resolve();
let nomLast = 0;
function nominatim(q) {
  const run = async () => {
    const wait = nomLast + g().nominatimGapMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    nomLast = Date.now();
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '1', 'accept-language': /[؀-ۿ]/.test(q) ? 'ar' : 'en' })}`;
    const res = await net.get(url, { timeoutMs: g().geocodeTimeoutMs });
    if (!res || !res.ok) throw new Error(`Nominatim HTTP ${res && res.status}`);
    const arr = await res.json();
    const r = Array.isArray(arr) && arr[0];
    if (!r) return null;
    const lat = Number(r.lat), lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const label = String(r.display_name || q).split(',').slice(0, 2).map(s => s.trim()).join('، ');
    return { lat, lon, label, kind: 'place', country: null, source: 'nominatim' };
  };
  const p = nomChain.then(run, run);
  nomChain = p.catch(() => {});
  return p;
}

/**
 * @param {string} text what the player typed
 * @returns {Promise<{lat:number, lon:number, label:string, kind:string, source:string}|null>}
 *   null = not a place we can find. Network errors also give null (the player can simply try again).
 */
async function locate(text) {
  const q = toQuery(text);
  if (!q) return null;
  const key = normalize(q) || q.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const off = fromCountries(q);
  if (off) return remember(key, off);

  let found = null, failed = false;
  try { found = await openMeteo(q); } catch (err) { failed = true; console.error('[Geo] place lookup (Open-Meteo) failed:', err.message); }
  if (!found) {
    try { found = await nominatim(q); } catch (err) { failed = true; console.error('[Geo] place lookup (Nominatim) failed:', err.message); }
  }
  // Don't cache a miss caused by a network error: the next try may work.
  if (!found && failed) return null;
  return remember(key, found);
}

function clearCache() { cache.clear(); nomLast = 0; }

module.exports = { locate, toQuery, fromCountries, clearCache };
