module.exports = {
  botToken: process.env.BOT_TOKEN,

  // Rotation system config (unchanged)
  rotation: {
    serverId: "1357219315820269578",
    templateChannelId: "1357388121704239134",
    categoryId: "1357382666378280970",
    targetChannelName: "👠．شات・الفساد",
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
      "1358456147191005336",  // category 3
      "1428663907660202077"   // category 4
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
    // Specific channels to scan
    channels: [
      "1364390818970079272",
      "1364717468781908159",
      "1364663053039435786",
      "1428049269360955463",
      "1428050046590390313",
      "1357350344681717940",
      "1428052930837090334",
      "1357525159279333557"
    ],
    // Category to also scan (all text channels inside it)
    category: "1358456147191005336",
    // Only scan members who have this role
    trackedRole: "1407774752319344763",
    // Where to send the monthly statp report
    reportChannel: "1437817609587523674",
    // Monthly auto-report: 1:00 AM Riyadh time on the 1st of every month
    monthlySchedule: "0 1 1 * *",
    timezone: "Asia/Riyadh",
  },
};
