// Object list: drop-down in the top-right of the 3D view.
// Each row = name (click to select, double-click to rename), visibility icon (3 clicks), trash can.
const el = (tag, css = "") => { const e = document.createElement(tag); e.style.cssText = css; return e; };
const svg = (inner, style = "") => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;${style}">${inner}</svg>`;
const EYE = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>';
const ICON = [svg(EYE), svg(EYE, "opacity:.35"), svg(EYE + '<line x1="3" y1="3" x2="21" y2="21"/>')]; // visible, transparent (greyed eye), not visible (crossed-out eye)
const TIP = ["Visible (click for transparent)", "Transparent (click to hide)", "Not visible (click to show)"];
const TRASH = svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>');

export function initObjectList({ view }) {
  const items = []; let selected = null, open = false, nextId = 1, pick = () => {};

  const box = el("div", "position:absolute;top:8px;right:8px;z-index:5;text-align:right");
  const toggle = el("button"); box.append(toggle);
  const menu = el("div", "display:none;margin-top:4px;min-width:240px;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:4px;text-align:left");
  box.append(menu); view.append(box);
  toggle.onclick = () => { open = !open; render(); };
  document.addEventListener("click", (e) => { if (open && !e.composedPath().includes(box)) { open = false; render(); } });

  // names: first one stays plain, later duplicates get -1, -2, ...
  function unique(base, self) {
    const taken = new Set(items.filter((i) => i !== self).map((i) => i.name));
    if (!taken.has(base)) return base;
    let n = 1; while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }
  // visible / transparent / not visible (only the main mesh of each object is touched)
  function apply(it) {
    it.object.visible = it.vis !== 2;
    it.object.traverse((o) => {
      if (!o.isMesh || !o.userData.base) return;
      const m = o.material; m.transparent = it.vis === 1; m.opacity = it.vis === 1 ? 0.25 : 1; m.depthWrite = it.vis !== 1; m.needsUpdate = true;
    });
  }
  const paint = () => items.forEach((it) => { if (!it.row) return; it.row.style.background = it === selected ? "var(--chip)" : ""; it.row.style.outline = it === selected ? "1px solid var(--fg)" : ""; });

  function rename(it, span) {
    const inp = el("input", "flex:1;min-width:0"); inp.value = it.name; span.replaceWith(inp); inp.focus(); inp.select();
    let finished = false;
    const done = (ok) => { if (finished) return; finished = true; if (ok && inp.value.trim()) { it.name = unique(inp.value.trim(), it); it.auto = false; } render(); };
    inp.onkeydown = (e) => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); };
    inp.onblur = () => done(true);
  }
  function render() {
    toggle.textContent = `Objects (${items.length}) ${open ? "▴" : "▾"}`;
    menu.style.display = open ? "" : "none"; if (!open) return;
    menu.innerHTML = "";
    items.forEach((it) => {
      const r = el("div", "display:flex;gap:4px;align-items:center;padding:2px;border-radius:3px"); it.row = r;
      const name = el("span", "flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"); name.textContent = it.name; name.title = "Click to select, double-click to rename";
      name.onclick = () => select(it); name.ondblclick = () => rename(it, name);
      const vis = el("button", "margin:0;padding:4px 6px"); vis.innerHTML = ICON[it.vis]; vis.title = TIP[it.vis]; vis.onclick = () => { it.vis = (it.vis + 1) % 3; apply(it); render(); };
      const del = el("button", "margin:0;padding:4px 6px"); del.innerHTML = TRASH; del.title = it.deletable ? "Delete" : "The robotic flange cannot be deleted";
      if (it.deletable) del.onclick = () => remove(it); else { del.disabled = true; del.style.opacity = ".35"; }
      r.append(name, vis, del); menu.append(r);
    });
    paint();
  }
  function select(it) { selected = it; paint(); pick(it); }
  function remove(it) {
    const i = items.indexOf(it); if (i < 0 || !it.deletable) return;
    items.splice(i, 1); if (selected === it) selected = null;
    it.onRemove?.(it); render();
  }
  render();
  return {
    add({ name, object, deletable = true, auto = true, onRemove }) {
      const it = { id: nextId++, name: "", object, deletable, auto, vis: 0, onRemove };
      it.name = unique(name, it); items.push(it); apply(it); render(); return it;
    },
    remove, select,
    readd(it) { if (!items.includes(it)) { items.push(it); apply(it); render(); } }, // puts a removed row back (Undo)
    items: () => items,
    setName: (it, name) => { it.name = unique(name, it); render(); },
    setVis: (it, v) => { it.vis = v; apply(it); render(); }, // 0 visible, 1 transparent, 2 not visible
    refreshVisibility: () => items.forEach(apply), // call after an object's mesh was replaced
    onSelect: (fn) => (pick = fn),
  };
}