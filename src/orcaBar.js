// Tool bar at the top of the 3D view (inspired by the top bar of Orca Slicer): icon buttons pick the active tool,
// the tool's settings open in one panel under the bar. Click the active button again to switch the tool off.
import { el } from "./ui.js";

const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  move: svg('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>'),
  scale: svg('<path d="M4 20V10h10v10z"/><path d="M14 10l6-6M14.5 4H20v5.5"/>'),
  snap: svg('<path d="M3 6h7v12H3z"/><path d="M14 6h7v12h-7z"/><path d="M10 12h4M12 10l2 2-2 2"/>'),
};

// tools = [{ id, title, icon }]; onTool(id or null) runs on every change. Returns { set, get, show, enable, panel(id) }.
export function initOrcaBar({ view, tools, onTool }) {
  const bar = el("div"), wrap = el("div"), btns = {}, panels = {}; let now = null;
  bar.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:5;display:none;gap:2px;padding:3px;background:var(--bg);border:1px solid var(--line);border-radius:6px";
  wrap.style.cssText = "position:absolute;top:54px;left:50%;transform:translateX(-50%);z-index:5;display:none;width:300px;max-width:90%;box-sizing:border-box;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px 8px;text-align:left";
  for (const t of tools) {
    const b = el("button"); b.type = "button"; b.title = t.title; b.innerHTML = t.icon;
    b.style.cssText = "width:38px;height:38px;padding:5px;margin:0;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:4px;background:none;color:var(--fg)";
    b.onclick = () => set(now === t.id ? null : t.id);
    btns[t.id] = b; bar.append(b);
    const p = panels[t.id] = el("div"); p.style.display = "none"; wrap.append(p);
  }
  view.append(bar, wrap);
  let shown = false;
  function paint() {
    for (const id in btns) { const on = id === now; btns[id].style.background = on ? "var(--fg)" : "none"; btns[id].style.color = on ? "var(--bg)" : "var(--fg)"; panels[id].style.display = on ? "" : "none"; }
    bar.style.display = "flex"; wrap.style.display = shown && now ? "" : "none";
  }
  function set(id) { now = id; paint(); onTool(id); }
  return {
    set, get: () => now, panel: (id) => panels[id],
    show(on) { shown = on; paint(); }, // on = the tool panels may open (the bar itself is always there)
    enable(id, on) { btns[id].disabled = !on; btns[id].style.opacity = on ? "" : "0.35"; },
  };
}
