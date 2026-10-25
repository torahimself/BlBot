'use strict';
// Calendar helpers. Everything that depends on "what day / week is it" goes
// through here so weekly resets, the 30-day window and events all agree.
//
// Weeks start on SUNDAY 00:00 in settings.timezone (Asia/Riyadh).
// Days are identified by 'YYYY-MM-DD' strings in that timezone.

const settings = require('./settings');

let _fmt = null;
let _fmtZone = null;
function fmt() {
  if (!_fmt || _fmtZone !== settings.timezone) {
    _fmtZone = settings.timezone;
    _fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', weekday: 'short',
    });
  }
  return _fmt;
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const pad = (n) => String(n).padStart(2, '0');

function parts(ts) {
  const o = {};
  for (const p of fmt().formatToParts(new Date(ts))) o[p.type] = p.value;
  return {
    year: +o.year, month: +o.month, day: +o.day,
    hour: (+o.hour) % 24, minute: +o.minute, second: +o.second,
    weekday: WEEKDAYS[o.weekday],
  };
}

function dayKey(ts) {
  const p = parts(ts);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// 'YYYY-MM-DD' of the Sunday that starts the week containing ts.
function weekStartKey(ts) {
  return addDays(dayKey(ts), -parts(ts).weekday);
}

// Keys used by every cap query.
//   weekStart    → first day of the current Sunday-based week
//   rollingStart → first day of the 30-day window (today and the 29 days before)
function windowKeys(ts) {
  const today = dayKey(ts);
  return { today, weekStart: weekStartKey(ts), rollingStart: addDays(today, -29) };
}

// How far ahead of UTC the timezone is at instant ts.
function tzOffsetMs(ts) {
  const p = parts(ts);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// Timestamp (ms) of local midnight at the start of day `key`.
function startOfDayTs(key) {
  const [y, m, d] = key.split('-').map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  let t = utcMidnight - tzOffsetMs(utcMidnight);
  t = utcMidnight - tzOffsetMs(t); // second pass handles offset changes
  return t;
}

// Timestamp of the next weekly reset (the next Sunday 00:00 local).
function nextWeekResetTs(ts) {
  return startOfDayTs(addDays(weekStartKey(ts), 7));
}

// Local hour of day (0–23), for night-time logic in later features.
function localHour(ts) { return parts(ts).hour; }

module.exports = {
  parts, dayKey, addDays, weekStartKey, windowKeys,
  tzOffsetMs, startOfDayTs, nextWeekResetTs, localHour,
};
