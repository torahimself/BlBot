const config = require('../config.js');
const { PermissionsBitField } = require('discord.js');

let rotationInterval;
let rotationCount = 0;
let nextRotationTime = null;
let lastRotationTime = null;

// Calculate 6 AM Riyadh time (3 AM UTC)
function calculateNextRotationTime() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(3, 0, 0, 0);
  if (now.getTime() > next.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

function scheduleNextRotation() {
  nextRotationTime = calculateNextRotationTime();
  
  const now = new Date();
  const timeUntilRotation = nextRotationTime.getTime() - now.getTime();
  const hoursUntil = Math.round(timeUntilRotation / (1000 * 60 * 60));
  
  console.log(`⏰ Next rotation in ${hoursUntil}h at: ${nextRotationTime.toUTCString()} (6 AM Riyadh)`);
}

function startRotationCycle(client) {
  const now = new Date();
  nextRotationTime = calculateNextRotationTime();
  const timeUntilRotation = nextRotationTime.getTime() - now.getTime();

  console.log(`⏰ First rotation in: ${Math.round(timeUntilRotation / (1000 * 60 * 60))} hours`);

  // Clear any existing interval
  if (rotationInterval) {
    clearInterval(rotationInterval);
  }

  setTimeout(() => {
    rotateChannel(client);
    // Set daily interval
    rotationInterval = setInterval(() => rotateChannel(client), config.rotation.rotationInterval);
  }, timeUntilRotation);
}

async function rotateChannel(client) {
  try {
    rotationCount++;
    console.log(`🔄 Starting daily channel rotation #${rotationCount}...`);

    const guild = client.guilds.cache.get(config.rotation.serverId);
    if (!guild) {
      console.log("❌ Server not found");
      return;
    }

    const templateChannel = guild.channels.cache.get(config.rotation.templateChannelId);
    if (!templateChannel) {
      console.log("❌ Template channel not found");
      return;
    }

    const category = guild.channels.cache.get(config.rotation.categoryId);
    if (!category) {
      console.log("❌ Category not found");
      return;
    }

    const oldChannel = guild.channels.cache.find(
      (ch) => ch.name === config.rotation.targetChannelName
    );

    // Get the actual channel objects and find the highest position
    let highestPosition = 0;
    let targetPosition = 0;

    console.log("📊 Calculating channel positions...");

    // Get all channels in the category
    const categoryChannels = guild.channels.cache.filter(
      (ch) => ch.parentId === config.rotation.categoryId
    );

    // Find the highest position among the specified channels
    for (const channelId of config.rotation.positionChannels) {
      const channel = categoryChannels.get(channelId);
      if (channel) {
        console.log(`📍 Channel ${channel.name}: Position ${channel.position}`);
        if (channel.position > highestPosition) {
          highestPosition = channel.position;
        }
      } else {
        console.log(`❌ Position channel not found: ${channelId}`);
      }
    }

    // Set position to be right after the highest of the specified channels
    targetPosition = highestPosition + 1;

    console.log(`🎯 Target position: ${targetPosition} (after position ${highestPosition})`);
    console.log(`📋 Creating new channel: ${config.rotation.targetChannelName}`);

    // Start from the template channel's overwrites, then merge in any extra
    // per-role overwrites configured for the rotation channel (added on top,
    // not replacing whatever the template already grants that role).
    const mergedOverwrites = new Map();
    for (const [id, overwrite] of templateChannel.permissionOverwrites.cache) {
      mergedOverwrites.set(id, {
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
      });
    }

    for (const extra of config.rotation.additionalPermissionOverwrites || []) {
      const allowBits = new PermissionsBitField(extra.allow || []).bitfield;
      const denyBits = new PermissionsBitField(extra.deny || []).bitfield;
      const existing = mergedOverwrites.get(extra.roleId);

      if (existing) {
        // Merge: OR the allow bits together, and remove any of the newly
        // allowed permissions from the existing deny bits so they don't
        // conflict (allow should win for permissions we're explicitly adding).
        const newAllow = existing.allow | allowBits;
        const newDeny = (existing.deny | denyBits) & ~allowBits;
        mergedOverwrites.set(extra.roleId, {
          id: extra.roleId,
          type: 0, // role-type overwrite
          allow: newAllow,
          deny: newDeny,
        });
      } else {
        mergedOverwrites.set(extra.roleId, {
          id: extra.roleId,
          type: 0,
          allow: allowBits,
          deny: denyBits,
        });
      }
    }

    // Create channel with the custom topic
    const newChannel = await guild.channels.create({
      name: config.rotation.targetChannelName,
      type: templateChannel.type,
      parent: config.rotation.categoryId,
      topic: "شات مخصص للرول بلاي - يرجى مراجعة القوانين",
      nsfw: templateChannel.nsfw,
      permissionOverwrites: [...mergedOverwrites.values()],
      rateLimitPerUser: templateChannel.rateLimitPerUser,
    });

    console.log(`✅ New channel created: ${newChannel.id} at initial position ${newChannel.position}`);

    // Set the position explicitly after creation
    console.log(`📐 Setting channel position to: ${targetPosition}`);
    await newChannel.setPosition(targetPosition);
    console.log(`✅ Channel position updated to: ${newChannel.position}`);

    if (oldChannel) {
      await oldChannel.delete();
      console.log(`🗑️ Old channel deleted: ${oldChannel.id}`);
    }

    await newChannel.send(
      `🔄 **Channel Auto-Rotated**\n• Rotation #${rotationCount}\n• Created: <t:${Math.floor(Date.now() / 1000)}:F>\n• Next rotation: <t:${Math.floor((Date.now() + config.rotation.rotationInterval) / 1000)}:F>\n• Position: Below specified channels`
    );

    // Update rotation times
    lastRotationTime = new Date();
    scheduleNextRotation();
    
    console.log(`🎯 Daily rotation #${rotationCount} completed successfully! Final channel position: ${newChannel.position}`);
  } catch (error) {
    console.error("❌ Error during rotation:", error);
  }
}

// Public API for status endpoint and commands
function getNextRotationTime() {
  if (!nextRotationTime) {
    nextRotationTime = calculateNextRotationTime();
  }
  return nextRotationTime;
}

function getLastRotationTime() {
  return lastRotationTime;
}

function getRotationCount() {
  return rotationCount;
}

function setLastRotationTime(time) {
  lastRotationTime = time;
}

module.exports = {
  scheduleNextRotation,
  startRotationCycle,
  rotateChannel,
  getNextRotationTime,
  getLastRotationTime,
  getRotationCount,
  setLastRotationTime
};
