'use strict';
// Settings for the Arabic party games (/play). Everything tunable is here.
module.exports = {
  // Same channels as every other game (utils/gameChannels.js).
  channels: require('../gameChannels.js').IDS,

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
    // «.توقف» — the member who started the game (or a moderator) stops it; every stake is refunded.
    stopWords: ['توقف', 'ايقاف', 'وقف', 'ستوب'],
    // «.العاب» — shows every game with a one-line explanation.
    helpWords: ['العاب', 'ألعاب', 'الالعاب', 'قائمة'],
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
    minPlayers: 1,           // solo games count too (still capped per day, and 30 s minimum)
    minDurationMs: 30 * 1000,
  },

  guess:      { min: 1, max: 10, roundMs: 20 * 1000, hintAfterMs: 10 * 1000, rounds: 8 },
  roulette:   { min: 3, max: 12, pickMs: 15 * 1000, pauseMs: 2500, revealPadMs: 700 },
  // Street-photo game (.جيو): a photo is shown, players TYPE the COUNTRY (Arabic or English). The first valid
  // guess is final, a country can be taken once per round, the right country scores 40, others by distance.
  // Photos: Mapillary street-level photos when a free MAPILLARY_TOKEN is set, then Wikimedia Commons
  // (no key). See GEO_SETUP.md.
  geo: {
    mapillaryToken: '',          // or set the MAPILLARY_TOKEN environment variable
    providers: ['mapillary', 'wikimedia'],   // order tried; remove one to turn it off
    min: 1, max: 10, rounds: 5,
    roundMs: 50 * 1000,          // hints come at 1/3 and 2/3 of this
    allGuessedGraceMs: 1500,     // when everybody has chosen a country the round ends this long after the last one
    introMs: 2500, pauseMs: 6000,
    attempts: 6,                 // tries per round to find a photo (different places)
    bboxHalfDeg: 0.004,          // Mapillary search box half-size — its API rejects/times out on boxes of 0.01° or more
    jitterDeg: 0.05,             // random offset around the city so rounds differ (~5 km)
    wikiRadiusM: 8000,           // Wikimedia search radius around that point
    maxPhotoKm: 30,              // a photo farther than this from the place the round picked is thrown away
    limit: 10, httpTimeoutMs: 9000,
    parkAfterFails: 2, parkMs: 10 * 60 * 1000,   // a provider failing twice in a row is skipped for 10 minutes
    fetch: null,                 // tests inject a fake here
  },
  mafia:      { min: 5, max: 12, nightMs: 35 * 1000, talkMs: 45 * 1000, voteMs: 30 * 1000 },
  categories: {
    min: 1, max: 8,
    rounds: 5,                    // letters per game (one letter per round, all 5 categories each)
    turnMs: 15 * 1000,            // time a picked player has to type an answer
    pointsCorrect: 10,
    voteMs: 12 * 1000,            // players vote on a word that is not in the category list
    maxIdleCategories: 3,         // this many unanswered categories in a row → the game ends
    crossCheck: true,             // reject a real word that belongs to another category (a car as an animal)
    // Letters a round may use (hard letters ث ذ ز ض ط ظ غ و ي ه ء are left out on purpose).
    letters: ['ا', 'ب', 'ت', 'ج', 'ح', 'خ', 'د', 'ر', 'س', 'ش', 'ص', 'ع', 'ف', 'ق', 'ك', 'ل', 'م', 'ن'],
    introMs: 2500, pauseMs: 1500, betweenTurnsMs: 1200, roundPauseMs: 4000,
  },
};
