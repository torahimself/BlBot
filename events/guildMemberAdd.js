const { handleRejoin } = require('../utils/jail/jailManager.js');

module.exports = {
    name: 'guildMemberAdd',
    async execute(member) {
        try {
            await handleRejoin(member.client, member);
        } catch (err) {
            console.error(`[Jail] Error handling rejoin for ${member.id}:`, err.message);
        }
    }
};
