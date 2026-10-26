'use strict';
// Checks the .env file for the mistakes that make a token "disappear", and prints
// plain-English hints. It NEVER prints a value — only line numbers and variable names.
//
// Correct format: one variable per line, NAME=value, the value on the SAME line:
//     BOT_TOKEN=your-discord-bot-token
//     MAPILLARY_TOKEN=MLY|123456|abcdef
// A value on its own line (pressing Enter after "BOT_TOKEN=") is NOT read by dotenv:
// the variable stays empty and discord.js then reports an invalid/missing token.
//
// Called from index.js right after dotenv. No dependencies.

const fs = require('fs');
const path = require('path');

const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*?)\s*$/;

// Removes surrounding spaces / one pair of matching quotes (what people paste by accident).
function cleanValue(v) {
  if (typeof v !== 'string') return v;
  let s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) s = s.slice(1, -1).trim();
  return s;
}

/**
 * Pure analysis of the text of a .env file.
 * @returns {{ errors: string[], warnings: string[], keys: Map<string, {line:number, empty:boolean}> }}
 */
function analyze(text) {
  const errors = [];
  const warnings = [];
  const keys = new Map();
  if (typeof text !== 'string') return { errors, warnings, keys };

  if (text.charCodeAt(0) === 0xFEFF) warnings.push('[Env] The file starts with an invisible BOM character (saved as "UTF-8 with BOM"). It is handled, but save as plain UTF-8 if anything looks wrong.');
  const lines = text.replace(/^﻿/, '').split('\n');
  let crlf = 0;
  let prevEmptyKey = null;      // { name, line } when the previous line was "NAME=" with nothing after it

  lines.forEach((raw, i) => {
    const n = i + 1;
    if (raw.endsWith('\r')) crlf++;
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) { prevEmptyKey = null; return; }
    if (trimmed.startsWith('#')) return;

    const m = LINE_RE.exec(line);
    if (!m) {
      if (prevEmptyKey) {
        errors.push(`[Env] Line ${n} looks like the VALUE of ${prevEmptyKey.name} (line ${prevEmptyKey.line} is empty). Put it on the same line: ${prevEmptyKey.name}=value — no Enter in between.`);
      } else {
        errors.push(`[Env] Line ${n} looks like a value without a name — use NAME=value on ONE line.`);
      }
      prevEmptyKey = null;
      return;
    }
    const [, name, valueRaw] = m;
    const value = valueRaw;
    if (keys.has(name)) warnings.push(`[Env] ${name} appears more than once (lines ${keys.get(name).line} and ${n}); the first one wins.`);
    const empty = cleanValue(value) === '';
    if (!keys.has(name)) keys.set(name, { line: n, empty });
    if (empty) {
      warnings.push(`[Env] ${name} (line ${n}) has no value.`);
      prevEmptyKey = { name, line: n };
      return;
    }
    prevEmptyKey = null;

    const q = value[0];
    if ((q === '"' || q === "'") && !(value.length >= 2 && value.endsWith(q))) {
      warnings.push(`[Env] ${name} (line ${n}) starts with a quote but never closes it.`);
    } else if (q !== '"' && q !== "'") {
      if (/\s/.test(value)) warnings.push(`[Env] ${name} (line ${n}) contains a space — tokens never do. Check for extra text on that line.`);
      if (/\s#/.test(value) || value.includes('#')) warnings.push(`[Env] ${name} (line ${n}) contains "#": everything after an unquoted # is treated as a comment and cut off. Wrap the value in quotes if the # is part of it.`);
    }
  });
  if (crlf > 0) warnings.push('[Env] The file uses Windows line endings (CRLF). That is handled, nothing to do.');
  return { errors, warnings, keys };
}

/** A Discord bot token has 3 parts separated by dots. */
function looksLikeDiscordToken(v) {
  return typeof v === 'string' && /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(v);
}

/**
 * Reads .env, prints problems, cleans the token variables (spaces/quotes) and
 * reports whether the bot can start.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function run({ envPath = path.join(__dirname, '..', '.env'), env = process.env, log = console, silent = false } = {}) {
  let text = null;
  try { text = fs.readFileSync(envPath, 'utf8'); } catch (_) { /* no .env file: variables may come from the host panel */ }
  const a = text === null ? { errors: [], warnings: [], keys: new Map() } : analyze(text);
  const errors = [...a.errors];
  const warnings = [...a.warnings];

  for (const name of ['BOT_TOKEN', 'MAPILLARY_TOKEN']) {
    if (typeof env[name] === 'string') env[name] = cleanValue(env[name]);   // trim spaces / quotes sanely
  }

  if (!env.BOT_TOKEN) {
    errors.push(text === null
      ? '[Env] BOT_TOKEN is missing/empty and there is no .env file next to index.js (or set BOT_TOKEN in the hosting panel).'
      : '[Env] BOT_TOKEN is missing/empty. In .env write it on ONE line like:  BOT_TOKEN=<your token>');
  } else if (!looksLikeDiscordToken(env.BOT_TOKEN)) {
    warnings.push('[Env] BOT_TOKEN does not look like a Discord bot token (expected three parts separated by dots). Copy it again from the Developer Portal → Bot → Reset Token.');
  }
  if (!env.MAPILLARY_TOKEN) {
    warnings.push('[Env] MAPILLARY_TOKEN is not set — the street-photo game (.شارع) will say it is not configured. Everything else works.');
  } else if (!/^MLY\|/.test(env.MAPILLARY_TOKEN)) {
    warnings.push('[Env] MAPILLARY_TOKEN usually starts with "MLY|". Check that you copied the Client Token.');
  }

  if (!silent) {
    for (const w of warnings) log.warn(w);
    for (const e of errors) log.error(e);
  }
  return { ok: !errors.some(e => /BOT_TOKEN is missing/.test(e)), errors, warnings };
}

module.exports = { analyze, run, cleanValue, looksLikeDiscordToken };
