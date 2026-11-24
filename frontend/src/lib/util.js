export const uid = () => Math.random().toString(36).slice(2, 9);
export const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
// shrink [a, z) so it holds no leading/trailing whitespace (Windows double-click grabs the trailing space)
export function trimWs(s, a, z) { while (a < z && /\s/.test(s[a])) a++; while (z > a && /\s/.test(s[z - 1])) z--; return [a, z]; }

export const ME = new URLSearchParams(location.search).get('user') || 'Alice';
export const OTHER = ME === 'Alice' ? 'Bob' : 'Alice';
const UC = { Alice: 'var(--alice)', Bob: 'var(--bob)' };
// anyone beyond the paper's two: a stable hue from the name
export const ucol = u => UC[u] || (u ? `hsl(${[...u].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 55% 42%)` : 'var(--ok)');

export const MECH = {
  refer:   { c: 'var(--refer)',   tip: 'Refer: rebuild MY source prompt from this prompt’s (or section’s) code + result' },
  request: { c: 'var(--request)', tip: 'Request: ask the owner to finish this; my prompt updates when it is done and again whenever it changes' },
  share:   { c: 'var(--share)',   tip: 'Share: push my source into this prompt or task (owner must accept)' },
  link:    { c: 'var(--link)',    tip: 'Link: keep this node, prompt or section in sync with my source' },
};
