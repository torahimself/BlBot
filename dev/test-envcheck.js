'use strict';
// .env checker — node dev/test-envcheck.js   (all tokens below are FAKE)
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const envCheck = require(path.join(__dirname, '..', 'utils', 'envCheck.js'));
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message); } }

const FAKE = 'AAAAAAAAAAAAAAAAAAAAAAAA.BBBBBB.CCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const MAP = 'MLY|1234567|abcdef0123456789';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
function runWith(text, extraEnv = {}) {
  const p = path.join(dir, '.env' + Math.random().toString(36).slice(2));
  if (text !== null) fs.writeFileSync(p, text);
  // Simulate what dotenv would load (the real parser) into a private env object.
  const env = { ...extraEnv };
  if (text !== null) Object.assign(env, require('dotenv').parse(text));
  const r = envCheck.run({ envPath: p, env, silent: true });
  return { ...r, env, all: [...r.errors, ...r.warnings].join('\n') };
}

console.log('The owner\'s mistake: Enter after BOT_TOKEN=');
t('"BOT_TOKEN=" then the token on line 2 → BOT_TOKEN is empty and line 2 is blamed', () => {
  const r = runWith(`BOT_TOKEN=\n${FAKE}\n`);
  assert.strictEqual(r.ok, false);
  assert(/Line 2 looks like the VALUE of BOT_TOKEN/.test(r.all), r.all);
  assert(/BOT_TOKEN is missing\/empty/.test(r.all), r.all);
  assert(!r.env.BOT_TOKEN, 'dotenv really leaves the variable empty');
});
t('the message never contains the token', () => {
  const r = runWith(`BOT_TOKEN=\n${FAKE}\nMAPILLARY_TOKEN=${MAP}\n`);
  assert(!r.all.includes(FAKE) && !r.all.includes('AAAAAAAA') && !r.all.includes(MAP), 'no secret in the output');
});
t('a bare token line with no name at all', () => {
  const r = runWith(`${FAKE}\n`);
  assert(/Line 1 looks like a value without a name/.test(r.all), r.all);
  assert.strictEqual(r.ok, false);
});
t('"BOT_TOKEN" without = and the token under it', () => {
  const r = runWith(`BOT_TOKEN\n${FAKE}\n`);
  assert(/Line 1 looks like a value without a name/.test(r.all) && /Line 2/.test(r.all), r.all);
  assert.strictEqual(r.ok, false);
});

console.log('Correct files');
t('correct file → ok, no errors', () => {
  const r = runWith(`BOT_TOKEN=${FAKE}\nMAPILLARY_TOKEN=${MAP}\n`);
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.errors, []); assert.deepStrictEqual(r.warnings, []);
});
t('comments and blank lines are fine', () => {
  const r = runWith(`# my bot\n\nBOT_TOKEN=${FAKE}\n\n# map\nMAPILLARY_TOKEN=${MAP}\n`);
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.errors, []);
});
t('quotes and spaces around the token are cleaned', () => {
  const r = runWith(`BOT_TOKEN = "${FAKE}"  \nMAPILLARY_TOKEN='${MAP}'\n`);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.env.BOT_TOKEN, FAKE); assert.strictEqual(r.env.MAPILLARY_TOKEN, MAP);
});
t('a token with stray spaces/newline in the environment is trimmed', () => {
  const env = { BOT_TOKEN: `  ${FAKE}\n`, MAPILLARY_TOKEN: ` "${MAP}" ` };
  const r = envCheck.run({ envPath: path.join(dir, 'nope'), env, silent: true });
  assert.strictEqual(env.BOT_TOKEN, FAKE); assert.strictEqual(env.MAPILLARY_TOKEN, MAP); assert.strictEqual(r.ok, true);
});
t('Windows line endings and a BOM are tolerated', () => {
  const r = runWith(`﻿BOT_TOKEN=${FAKE}\r\nMAPILLARY_TOKEN=${MAP}\r\n`);
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.errors, []);
  assert(/BOM/.test(r.all) && /CRLF/.test(r.all), 'informational hints');
});

console.log('Other mistakes');
t('missing .env and no variable → clear message; host-panel variable → ok', () => {
  const none = runWith(null);
  assert.strictEqual(none.ok, false); assert(/no \.env file/.test(none.all), none.all);
  const panel = runWith(null, { BOT_TOKEN: FAKE });
  assert.strictEqual(panel.ok, true);
});
t('duplicate key, unclosed quote, space inside, # in value', () => {
  const r = runWith(`BOT_TOKEN=${FAKE}\nBOT_TOKEN=${FAKE}\nMAPILLARY_TOKEN="${MAP}\nDEV_USER_ID=12 34\nSECRET=ab#cd\n`);
  assert(/appears more than once/.test(r.all) && /never closes/.test(r.all) && /contains a space/.test(r.all) && /contains "#"/.test(r.all), r.all);
});
t('MAPILLARY_TOKEN missing is only a warning; wrong shape warns', () => {
  const a = runWith(`BOT_TOKEN=${FAKE}\n`);
  assert.strictEqual(a.ok, true); assert(a.warnings.some(w => /MAPILLARY_TOKEN is not set/.test(w)));
  const b = runWith(`BOT_TOKEN=${FAKE}\nMAPILLARY_TOKEN=abc\n`);
  assert(b.warnings.some(w => /MLY\|/.test(w)));
});
t('a token that is not Discord-shaped warns but does not block', () => {
  const r = runWith('BOT_TOKEN=not-a-token\n');
  assert.strictEqual(r.ok, true); assert(r.warnings.some(w => /does not look like a Discord bot token/.test(w)));
});

console.log(`\n${failed ? '❌' : '✅'}  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
