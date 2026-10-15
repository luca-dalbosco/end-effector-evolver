// Small panel helpers for stage 3. C = the stage 3 context (see index.js).
import { numberRow } from "../ui.js";

export const btn = (label, fn) => Object.assign(document.createElement("button"), { textContent: label, onclick: fn });
export const head = (host, t) => { const b = document.createElement("div"); b.textContent = t; b.className = "blk-head"; host.append(b); return b; };
export const textBox = (css) => { const d = document.createElement("div"); d.style.cssText = css; return d; };
export const clamp = (v, c) => Math.min(c.max, Math.max(c.min, v));
// wraps what was added to host since child number `from`, to show or hide it per method
export const group = (host, from) => { const w = document.createElement("div"); w.append(...[...host.children].slice(from)); host.append(w); return w; };

const okWarn = (rec, v) => (rec ? (v >= rec[0] && v <= rec[1] ? "ok" : "warn") : "");

// one setting C.S[key]: slider + typed value. rerun = a change rebuilds the design space or the bridge.
export function numRow(C, host, label, cfg, key, hidden = () => false, rerun = true, helpId) {
  const rec = cfg.recommendedRange;
  const nr = numberRow({ label, cfg, help: helpId, get: () => C.S[key], set: (v) => (C.S[key] = v), live: () => { C.sync(); if (key === "bslot") C.drawRobot(); },
    commit: () => rerun && C.schedule(), clamp: () => !C.advanced, hidden, note: (rec ? `recommended ${rec[0]} to ${rec[1]}. ` : "") + (cfg.note ?? ""),
    rate: (v) => okWarn(rec, v) });
  host.append(nr.el); C.refreshers.push(nr.refresh);
}

// like numRow, but shows the real size (base + adjust); the json still stores the adjust range
export function absRow(C, host, label, cfg, key, base) {
  const rnd = (v) => Math.round(v * 100) / 100, rec = cfg.recommendedRange;
  const nr = numberRow({ label, cfg, get: () => base() + C.S[key], set: (v) => (C.S[key] = rnd(v - base())), live: () => { C.sync(); C.drawRobot(); }, commit: C.schedule,
    clamp: () => !C.advanced, off: () => base() == null, bounds: () => [rnd(base() + cfg.min), rnd(base() + cfg.max)], digits: 2,
    rate: () => okWarn(rec, C.S[key]) });
  host.append(nr.el); C.refreshers.push(nr.refresh);
}
