'use strict';
// Starts the economy engine's background jobs. Called once from events/ready.js.
//
//   • the voice sampler (every minute: who is eligible RIGHT NOW → credit them)
//   • the event clock (every minute: finalise + pay a finished event, keep the
//     optional live progress message fresh)
//   • housekeeping (drops daily buckets older than 35 days)
//
// Text activity does not need a job: events/messageCreate.js calls
// activity.onMessage() for every message.

const settings = require('./settings');
const activity = require('./activity');
const events = require('./events');
const night = require('./night');
const { VoiceTicker } = require('./voice');

let ticker = null;
let timers = [];

function start(client) {
  settings.validate();                       // refuse to run with an invalid economy
  stop();

  ticker = new VoiceTicker(client);
  ticker.start();

  const eventTick = () => {
    events.finalizeIfDue(client).catch((err) => console.error('[Event] finalize failed:', err));
    events.updateProgressMessage(client).catch((err) => console.error('[Event] progress update failed:', err.message));
  };
  const prune = () => {
    activity.pruneOld().catch((err) => console.error('[Economy] prune failed:', err.message));
  };

  const nightTick = () => night.syncIfDue(client).catch((err) => console.error('[Night] sync failed:', err.message));
  timers.push(setInterval(nightTick, settings.nightRoles.syncIntervalMs));
  timers.push(setInterval(eventTick, 60 * 1000));
  timers.push(setInterval(prune, 6 * 60 * 60 * 1000));
  for (const t of timers) if (t.unref) t.unref();

  setTimeout(eventTick, 10 * 1000).unref?.();
  setTimeout(nightTick, 20 * 1000).unref?.();   // catches up after downtime
  setTimeout(prune, 30 * 1000).unref?.();

  const ev = events.current();
  console.log(`💰 Economy engine started (voice sampler every ${settings.voice.tickMs / 1000}s` +
    `${ev ? `, event "${ev.name}": ${events.phase()}` : ', no event configured'})`);
}

function stop() {
  if (ticker) ticker.stop();
  ticker = null;
  for (const t of timers) clearInterval(t);
  timers = [];
}

module.exports = { start, stop };
