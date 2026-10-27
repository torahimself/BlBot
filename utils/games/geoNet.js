'use strict';
// One injectable HTTP function for everything the geo game fetches (photos, place lookups),
// so tests run offline: setFetch(fn). Real runs use Node's global fetch.
const cfg = require('./config.js');

let override = null;
const UA = 'BlBot-GeoGame/1.0 (Discord bot; https://github.com/torahimself/blbot)';

function setFetch(fn) { override = fn; }
const getFetch = () => override || (cfg.geo && cfg.geo.fetch) || globalThis.fetch;

/** GET with a timeout and a polite User-Agent (Wikimedia and OSM require one). */
async function get(url, { timeoutMs = 8000, headers = {} } = {}) {
  const f = getFetch();
  const opts = { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } };
  if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(timeoutMs);
  return f(url, opts);
}

module.exports = { setFetch, getFetch, get, UA };
