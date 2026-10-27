'use strict';
// Distance → points for the street-photo game (جيو).
//   pinpoint (≤ 0.5 km)  40      20–100 km  ≈ 38 … 35      1,000 km  18
//   within 5 km          39      300 km     28             5,000 km  2
// Points depend ONLY on how close the pin is (GeoGuessr style), so the closest player always gets the most.

const MAX = 40;
// [km, points] — straight lines between rows, rounded to a whole number.
const CURVE = [
  [0, 40], [0.5, 40], [5, 39], [25, 38], [100, 35], [300, 28],
  [1000, 18], [2500, 8], [5000, 2], [8000, 0],
];

const R_EARTH = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

function pointsFor(km) {
  if (!(km >= 0)) return 0;
  if (km >= CURVE[CURVE.length - 1][0]) return 0;
  for (let i = 1; i < CURVE.length; i++) {
    const [x1, y1] = CURVE[i - 1], [x2, y2] = CURVE[i];
    if (km <= x2) return Math.round(y1 + ((y2 - y1) * (km - x1)) / (x2 - x1));
  }
  return 0;
}

/** "850 م" / "12 كم" / "1,240 كم" — Arabic units. */
function formatKm(km) {
  if (km < 1) return `${Math.max(1, Math.round(km * 1000))} م`;
  if (km < 10) return `${km.toFixed(1)} كم`;
  return `${Math.round(km).toLocaleString('en-US')} كم`;
}

module.exports = { MAX, CURVE, haversineKm, pointsFor, formatKm };
