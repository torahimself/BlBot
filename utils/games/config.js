'use strict';
// Settings for the Arabic party games (/play). Everything tunable is here.
module.exports = {
  // Same channels the other coin games use.
  channels: ['1415933682748751923', '1432459732358140106', '1357267422369026198'],

  // Chat trigger: <sign><word> [bet]   e.g.  .علم   .مافيا   .انسان 500
  // (the bet is optional; without a number the game is free). Change `sign`
  // here to use another symbol, e.g. '!' or '$'.
  trigger: {
    sign: '.',
    // game type → words that start it (matched after Arabic letter folding, so
    // أنسان / إنسان / انسان are all the same word).
    words: {
      guess:      ['علم', 'اعلام', 'خمن', 'دولة'],
      capital:    ['عاصمة', 'عواصم'],
      mafia:      ['مافيا', 'مافية'],
      categories: ['انسان', 'انسان_حيوان', 'حروف'],
      roulette:   ['روليت', 'روليت_الطرد', 'عجلة'],
      geo:        ['جيو', 'شارع', 'صورة'],
    },
    minBet: 10,
    maxBet: 10000,
  },

  lobby: {
    waitMs: 120 * 1000,        // cancel the lobby if the minimum isn't reached in time
    autoStartMs: 15 * 1000,    // once the minimum is reached, start this long after
    fullStartMs: 3 * 1000,     // lobby is full → start almost immediately
  },
  // A hard stop so a stuck game can never hold stakes forever.
  maxGameMs: 45 * 60 * 1000,

  // A finished game earns Halloween-event "games" points only when it was real.
  eventCredit: {
    minPlayers: 3,
    minDurationMs: 90 * 1000,
  },

  guess:      { min: 2, max: 10, roundMs: 20 * 1000, hintAfterMs: 10 * 1000, rounds: 8 },
  roulette:   { min: 3, max: 12, pickMs: 15 * 1000, pauseMs: 2500, revealPadMs: 700 },
  // Street-photo game (.جيو). Needs a free Mapillary token — see GEO_SETUP.md.
  geo: {
    mapillaryToken: '',          // or set the MAPILLARY_TOKEN environment variable
    min: 2, max: 10, rounds: 5,
    roundMs: 40 * 1000,          // hints come at 1/3 and 2/3 of this
    graceAfterFirstMs: 8 * 1000, // others may still answer this long after the first correct answer
    introMs: 2500, pauseMs: 3000,
    attempts: 4,                 // tries per round to find a photo (different places)
    bboxHalfDeg: 0.015,           // search box half-size (Mapillary limits the box area)
    jitterDeg: 0.25,             // random offset around the city so rounds differ
    limit: 15, httpTimeoutMs: 12000,
    fetch: null,                 // tests inject a fake here
  },
  mafia:      { min: 5, max: 12, nightMs: 35 * 1000, talkMs: 45 * 1000, voteMs: 30 * 1000 },
  categories: {
    min: 2, max: 8,
    rounds: 5,                    // letters per game (one letter per round, all 5 categories each)
    turnMs: 15 * 1000,            // time a picked player has to type an answer
    pointsCorrect: 10,
    maxAttempts: null,            // tries per category before «لم يُجَب»; null = min(maxAttemptsCap, max(4, 2 × players))
    maxAttemptsCap: 8,
    maxIdleCategories: 3,         // this many unanswered categories in a row → the game ends
    crossCheck: true,             // reject a real word that belongs to another category (a car as an animal)
    // Letters a round may use (hard letters ث ذ ز ض ط ظ غ و ي ه ء are left out on purpose).
    letters: ['ا', 'ب', 'ت', 'ج', 'ح', 'خ', 'د', 'ر', 'س', 'ش', 'ص', 'ع', 'ف', 'ق', 'ك', 'ل', 'م', 'ن'],
    introMs: 2500, pauseMs: 1500, betweenTurnsMs: 1200, roundPauseMs: 4000,
  },
};
