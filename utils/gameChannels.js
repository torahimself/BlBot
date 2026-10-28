'use strict';
// The ONLY channels where games can be played (slash games and the "." party games).
// Change the list here and every game follows.
const IDS = ['1494784455871565904', '1357267422369026198', '1415933682748751923'];
const mention = IDS.map((id) => `<#${id}>`).join(' or ');
module.exports = { IDS, mention };
