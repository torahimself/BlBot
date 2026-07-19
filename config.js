module.exports = {
  botToken: process.env.BOT_TOKEN,

  // Rotation system config (unchanged)
  rotation: {
    serverId: "1357219315820269578",
    templateChannelId: "1357388121704239134",
    categoryId: "1357382666378280970",
    targetChannelName: "👠．gooning・chat",
    positionChannels: [
      "1418663574493991144",
      "1357384022388379891"
    ],
    rotationInterval: 24 * 60 * 60 * 1000,
  },

  // Attachment counter system config
  attachmentCounter: {
    // Categories to scan (all text channels in these categories will be scanned)
    categoriesToScan: [
      "1357360836229730537",  // category 1
      "1357342267081359380",  // category 2
    ],
    // Individual channels/forums scanned directly, in addition to the
    // categories above (e.g. forums that live outside the scanned categories)
    additionalChannels: [
      "1501688044892196965",
    ],
    // Channels to exclude from scanning (even if they're in the above categories)
    excludedChannels: [
      "1390114909634957312",
      "1364197015378198528",
      "1409520434466263100",
      "1437817609587523674",
      "1380147485053423626"
    ],
    // Roles to track (only count attachments from these roles)
    trackedRoles: [
      "1357406949989155079",
      "1429900051223806122",
      "1429899952699474112",
      "1429900133268721796",
      "1357421725481959565",
      "1407774752319344763",
      "1357281801940369418"
    ],
    // Report channel
    reportChannel: "1435870655508774972",
    // Monthly auto-report: 1:00 AM Riyadh time on the 1st of every month
    monthlySchedule: "0 1 1 * *",
    timezone: "Asia/Riyadh",
  },

  // Statp system config — targeted monthly per-member report
  statp: {
    // Individual channels/forums scanned directly (in addition to any
    // category-based channels below).
    channels: [
      "1364390818970079272",
      "1364717468781908159",
      "1364663053039435786",
      "1428049269360955463",
      "1428050046590390313",
      "1357350344681717940",
      "1428052930837090334",
      "1357494760012779670",
      "1357525159279333557",
    ],
    // Categories to scan (all text + forum channels inside each will be scanned)
    categories: [
      "1358456147191005336",  // Boosters category (working)
      "1364189917412069457",  // Premium category (forums: ᴘ・ᴀʀᴀʙ, ᴍᴀɴɢᴀ, ʜᴇɴᴛᴀɪ, etc.)
    ],
    // Channels to exclude even if they're inside a scanned category or in
    // the explicit channels list above.
    excludedChannels: [
      "1390114909634957312",
      "1409520434466263100",
      "1364197015378198528",
      "1437817609587523674",
      "1520073343137616083",
    ],
    // Only scan members who have this role
    trackedRole: "1407774752319344763",
    // Where to send the monthly statp report
    reportChannel: "1437817609587523674",
    // Monthly auto-report: 1:00 AM Riyadh time on the 1st of every month
    monthlySchedule: "0 1 1 * *",
    timezone: "Asia/Riyadh",
  },

  // Jail system config
  jail: {
    logChannelId: "1528228047352889445",
    jailRoleId: "1528232163990835330",
    // How often to run the background check: auto-unjail expired sentences,
    // and re-enforce jail state for anyone whose roles drifted while still
    // in the server (e.g. a role was manually restored outside /unjail).
    checkIntervalMs: 2 * 60 * 1000, // 2 minutes
  },
};
