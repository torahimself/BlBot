'use strict';

// Riyadh is fixed at UTC+3 year-round (no daylight saving), so a simple
// fixed offset is reliable — no need for a timezone library.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Returns {year, month} (month is 0-indexed) representing the CURRENT date
// as seen in Riyadh local time, regardless of what timezone the host server
// itself runs in (Bubblehost may run UTC).
function getRiyadhYearMonth(date = new Date()) {
  const shifted = new Date(date.getTime() + RIYADH_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}

// Given a Riyadh-local year/month, returns the UTC instant (a real Date
// object) corresponding to the 1st of that month at 00:00 Riyadh time.
// `month` can be out of the 0-11 range (e.g. -1) — Date.UTC normalizes it,
// so passing month-1 correctly rolls back into December of the prior year.
function riyadhMonthStartUTC(year, month) {
  return new Date(Date.UTC(year, month, 1, 0, 0, 0) - RIYADH_OFFSET_MS);
}

// The full previous calendar month, in Riyadh time, relative to `now`.
// e.g. if today is 18 July 2026 (Riyadh), returns since=1 June 00:00,
// until=1 July 00:00 (exclusive upper bound), label="June 2026".
function getPreviousMonthRange(now = new Date()) {
  const { year, month } = getRiyadhYearMonth(now);
  const since = riyadhMonthStartUTC(year, month - 1);
  const until = riyadhMonthStartUTC(year, month); // start of current month = exclusive end of previous
  const labelDate = riyadhMonthStartUTC(year, month - 1);
  const label = `${MONTH_NAMES[getRiyadhYearMonth(labelDate).month]} ${getRiyadhYearMonth(labelDate).year}`;
  return { since, until, label };
}

// Rolling 30-day window ending right now — used for manual /statm and
// /statp commands, per spec: "counts from the time user made the command
// and 30 days prior".
function getRolling30DayRange(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const until = now;
  const label = `<t:${Math.floor(since.getTime() / 1000)}:D> – <t:${Math.floor(until.getTime() / 1000)}:D>`;
  return { since, until, label };
}

// Human-readable Riyadh date/time string, for startup logging.
function formatRiyadhNow(now = new Date()) {
  const shifted = new Date(now.getTime() + RIYADH_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = MONTH_NAMES[shifted.getUTCMonth()];
  const d = shifted.getUTCDate();
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${d} ${m} ${y}, ${hh}:${mm} (Riyadh time)`;
}

// ms until the next 1:00 AM Riyadh on the 1st of a month — matches the
// "0 1 1 * *" cron schedule. Used purely for informative startup logging;
// node-cron still owns the actual scheduling/firing.
function msUntilNextMonthlyRun(now = new Date()) {
  const { year, month } = getRiyadhYearMonth(now);
  let next = new Date(riyadhMonthStartUTC(year, month).getTime() + 60 * 60 * 1000); // 1 AM 1st of current month
  if (next.getTime() <= now.getTime()) {
    next = new Date(riyadhMonthStartUTC(year, month + 1).getTime() + 60 * 60 * 1000);
  }
  return { next, msUntil: next.getTime() - now.getTime() };
}

module.exports = {
  RIYADH_OFFSET_MS,
  MONTH_NAMES,
  getRiyadhYearMonth,
  riyadhMonthStartUTC,
  getPreviousMonthRange,
  getRolling30DayRange,
  formatRiyadhNow,
  msUntilNextMonthlyRun,
};
