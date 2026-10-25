// Voice coins are no longer paid from join/leave events. The economy engine
// (utils/economy/engine/voice.js) looks at every voice channel once a minute and
// pays the members who are eligible at that moment, so restarts, rejoin tricks
// and idle sessions can't be abused.
//
// This file is intentionally a no-op. It is kept (instead of deleted) so that an
// OLD copy of it can never be left on the host, where it would pay coins twice.
// You can delete it once you have confirmed the new version is deployed.
module.exports = {
  name: 'voiceStateUpdate',
  async execute() {},
};
