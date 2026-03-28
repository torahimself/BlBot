const commandHandler = require('../handlers/commandHandler');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    try {
      await interaction.deferReply();
    } catch (error) {
      console.error('Error deferring reply:', error);
      return;
    }

    const command = commandHandler.commands.get(interaction.commandName);
    if (!command) {
      await interaction.editReply('❌ Command not found!');
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing command ${interaction.commandName}:`, error);
      await interaction.editReply('❌ There was an error executing this command!');
    }
  },
};
