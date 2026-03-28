const fs = require('fs');
const path = require('path');
const commands = new Map();

function loadCommands() {
  const commandsPath = path.join(__dirname, '../commands');
  if (!fs.existsSync(commandsPath)) {
    fs.mkdirSync(commandsPath, { recursive: true });
    return;
  }

  function loadDir(dirPath) {
    const items = fs.readdirSync(dirPath);
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        loadDir(itemPath);
      } else if (item.endsWith('.js')) {
        try {
          const command = require(itemPath);
          if (command.data && command.data.name) {
            commands.set(command.data.name, command);
            console.log(`✅ Loaded command: ${command.data.name}`);
          }
        } catch (err) {
          console.error(`❌ Error loading command ${itemPath}:`, err.message);
        }
      }
    }
  }

  loadDir(commandsPath);
  console.log(`✅ Loaded ${commands.size} commands`);
}

function getCommands() {
  return Array.from(commands.values()).map(cmd => cmd.data.toJSON());
}

module.exports = { loadCommands, getCommands, commands };
