// Tiny DOM helpers for the UI layer.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const ICONS = {
  health: '<svg viewBox="0 0 16 16"><path d="M8 14s-5.5-3.4-5.5-7.2C2.5 4.6 4 3 5.8 3 7 3 7.7 3.7 8 4.4 8.3 3.7 9 3 10.2 3 12 3 13.5 4.6 13.5 6.8 13.5 10.6 8 14 8 14z"/></svg>',
  hunger: '<svg viewBox="0 0 16 16"><path d="M4 2v5a2 2 0 0 0 2 2v5M6 2v4M8 2v5a2 2 0 0 1-2 2M12 2c-1.5 1-2 3-2 5h2v7"/></svg>',
  thirst: '<svg viewBox="0 0 16 16"><path d="M8 2s-4.5 5-4.5 8a4.5 4.5 0 0 0 9 0C12.5 7 8 2 8 2z"/></svg>',
  stamina: '<svg viewBox="0 0 16 16"><path d="M9 1 3 9h4l-1 6 6-8H8l1-6z"/></svg>',
  temp: '<svg viewBox="0 0 16 16"><path d="M7 2h2v7.5a3 3 0 1 1-2 0z"/></svg>',
};

export function fmtKg(w) {
  return `${w.toFixed(1)} kg`;
}
