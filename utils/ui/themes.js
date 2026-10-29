'use strict';
// Looks a member can choose for their cards (profile + inventory). Add a theme / accent here and it shows up
// in the customise menu by itself. Everything is free for now; a shop can gate entries later by adding a
// `price` field and checking it in customize.js.

const THEMES = [
  { id: 'midnight', label: 'Midnight', emoji: '🌙', dark: true,  bg: ['#0e1126', '#1f2650'], pattern: 'dots',  accent: '#7c8cff' },
  { id: 'pumpkin',  label: 'Pumpkin',  emoji: '🎃', dark: true,  bg: ['#1a0c03', '#47200a'], pattern: 'web',   accent: '#ff8a1f' },
  { id: 'ocean',    label: 'Ocean',    emoji: '🌊', dark: true,  bg: ['#06202e', '#0b4f6c'], pattern: 'waves', accent: '#19c8d8' },
  { id: 'aurora',   label: 'Aurora',   emoji: '✨', dark: true,  bg: ['#0b1f1c', '#2a1d5e'], pattern: 'stars', accent: '#3ddc97' },
  { id: 'rose',     label: 'Rose',     emoji: '🌸', dark: true,  bg: ['#2a0f1f', '#5c1f3d'], pattern: 'dots',  accent: '#ff5c93' },
  { id: 'forest',   label: 'Forest',   emoji: '🌲', dark: true,  bg: ['#0c1d14', '#1f4a2e'], pattern: 'hex',   accent: '#8fe36b' },
  { id: 'sunset',   label: 'Sunset',   emoji: '🌅', dark: true,  bg: ['#2b0f3a', '#8a2f3a'], pattern: 'diag',  accent: '#ffb347' },
  { id: 'carbon',   label: 'Carbon',   emoji: '⚫', dark: true,  bg: ['#0c0d10', '#23252d'], pattern: 'grid',  accent: '#e6e8f0' },
  { id: 'snow',     label: 'Snow',     emoji: '❄️', dark: false, bg: ['#eef1fa', '#cfd8ee'], pattern: 'dots',  accent: '#4f63e8' },
];

const ACCENTS = [
  { id: 'blurple', label: 'Blurple', emoji: '🟣', hex: '#5865f2' },
  { id: 'orange',  label: 'Orange',  emoji: '🟠', hex: '#ff8a1f' },
  { id: 'pink',    label: 'Pink',    emoji: '🌸', hex: '#ff5c93' },
  { id: 'red',     label: 'Red',     emoji: '🔴', hex: '#f04747' },
  { id: 'gold',    label: 'Gold',    emoji: '🟡', hex: '#f5c518' },
  { id: 'green',   label: 'Green',   emoji: '🟢', hex: '#3ddc97' },
  { id: 'teal',    label: 'Teal',    emoji: '🩵', hex: '#19c8d8' },
  { id: 'sky',     label: 'Sky',     emoji: '🔵', hex: '#4da3ff' },
  { id: 'violet',  label: 'Violet',  emoji: '🟪', hex: '#a66bff' },
  { id: 'white',   label: 'White',   emoji: '⚪', hex: '#f2f2f2' },
];

const SHAPES = [
  { id: 'circle',  label: 'Circle' },
  { id: 'rounded', label: 'Rounded square' },
  { id: 'hex',     label: 'Hexagon' },
];
const LAYOUTS = [
  { id: 'full',    label: 'Full' },
  { id: 'compact', label: 'Compact' },
];

const DEFAULTS = { theme: 'midnight', accent: null, shape: 'circle', layout: 'full', featured: null, about: '' };

const byId = (list, id) => list.find(x => x.id === id) || null;
const themeOf = (id) => byId(THEMES, id) || THEMES[0];
const HEX = /^#?([0-9a-f]{6})$/i;

/** «ff8a1f», «#FF8A1F» → '#ff8a1f', or null. */
function parseHex(v) { const m = HEX.exec(String(v || '').trim()); return m ? '#' + m[1].toLowerCase() : null; }

/** About-me text: one line, no links / mentions / control characters, at most 60 characters. */
function cleanAbout(v) {
  return String(v == null ? '' : v)
    .replace(/https?:\/\/\S+|www\.\S+|discord\.gg\/\S+/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/@(everyone|here)/gi, ' ')
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** The accent a card really uses: the member's own, else the theme's. */
const accentOf = (prefs) => parseHex(prefs.accent) || themeOf(prefs.theme).accent;

/** Colours that depend on light / dark. */
function palette(theme, accent) {
  const d = theme.dark;
  return {
    text: d ? '#ffffff' : '#141728',
    sub: d ? 'rgba(255,255,255,0.66)' : 'rgba(20,23,40,0.66)',
    faint: d ? 'rgba(255,255,255,0.12)' : 'rgba(20,23,40,0.10)',
    panel: d ? 'rgba(8,10,24,0.55)' : 'rgba(255,255,255,0.62)',
    tile: d ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.7)',
    track: d ? 'rgba(255,255,255,0.14)' : 'rgba(20,23,40,0.14)',
    accent,
  };
}

module.exports = { THEMES, ACCENTS, SHAPES, LAYOUTS, DEFAULTS, themeOf, byId, parseHex, cleanAbout, accentOf, palette };
