// Shared UI kit: collapsible sections, "?" help icons (texts in data/help.json), switches, button groups,
// and the one Advanced switch under the stage tabs (each stage keeps its own on/off).
import helpText from "../data/help.json";

export const el = (tag, cls = "", text = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
export const line = (cls, text) => el("div", cls, text); // one message line (text is never parsed as HTML)
export const download = (file, data) => { // hands a file from memory to the browser's download
  const url = URL.createObjectURL(new Blob([data])), a = Object.assign(document.createElement("a"), { href: url, download: file });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const esc =(t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); // for text put inside innerHTML

// one floating tip box for every "?" (shows on hover, and on tap/click until you click elsewhere)
let tip = null, pinned = null;
function showTip(icon) {
  if (!tip) { tip = el("div", "tip"); document.body.append(tip); }
  tip.textContent = icon.dataset.tip; tip.style.display = "block";
  const r = icon.getBoundingClientRect(), w = Math.min(280, innerWidth - 16);
  tip.style.width = w + "px"; tip.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - w - 8)) + "px";
  const below = r.bottom + 6, h = tip.offsetHeight;
  tip.style.top = (below + h > innerHeight - 8 ? r.top - h - 6 : below) + "px";
}
const hideTip = () => { if (tip) tip.style.display = "none"; };
document.addEventListener("click", () => { pinned = null; hideTip(); });

export function help(id) {
  const t = helpText[id]; if (!t) return document.createTextNode("");
  const s = el("span", "help", "?"); s.dataset.tip = t; s.tabIndex = 0;
  s.onmouseenter = () => showTip(s); s.onmouseleave = () => { if (pinned !== s) hideTip(); };
  s.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (pinned === s) { pinned = null; hideTip(); } else { pinned = s; showTip(s); } };
  return s;
}

// collapsible heading; put the section's controls into `body`
export function section(title, helpId, open = true) {
  const box = el("div", "sec"), head = el("div", "sec-head"), body = el("div", "sec-body");
  head.append(el("span", "sec-arrow", "▾"), el("span", "", title), help(helpId));
  const set = (o) => { box.classList.toggle("closed", !o); };
  head.onclick = () => set(box.classList.contains("closed")); set(open);
  box.append(head, body);
  return { box, body, set };
}

// on/off switch
export function toggle(label, onChange, helpId) {
  const l = el("label", "switch"), input = Object.assign(el("input"), { type: "checkbox" });
  l.append(input, el("span", "knob"), el("span", "", label), help(helpId));
  input.onchange = () => onChange(input.checked);
  return { el: l, input, set: (v) => (input.checked = v) };
}

// button group, one option active: options = [{ id, label }]
export function segmented(options, onChange) {
  const box = el("div", "seg");
  const btns = options.map((o) => { const b = el("button", "", o.label); b.type = "button"; b.dataset.id = o.id; b.onclick = () => { set(o.id); onChange(o.id); }; box.append(b); return b; });
  const set = (id) => btns.forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  const enable = (id, on, tip = "") => btns.forEach((b) => { if (b.dataset.id === id) { b.disabled = !on; b.title = on ? "" : tip; } }); // greyed out with a hover tip
  return { el: box, set, enable };
}

// Colour of a typed value: green inside the recommended range, red inside the not-recommended range or outside min..max, orange otherwise.
export function rateOf(cfg, v) {
  const rec = cfg.recommendedRange, bad = cfg.notRecommendedRange, inR = (r) => r && v >= r[0] && v <= r[1];
  if (inR(rec)) return "ok";
  if (inR(bad) || v < cfg.min || v > cfg.max) return "bad";
  return rec ? "warn" : "";
}
export const recNote = (cfg) => [cfg.recommendedRange && `recommended ${cfg.recommendedRange[0]} to ${cfg.recommendedRange[1]}`,
  cfg.notRecommendedRange && `not recommended ${cfg.notRecommendedRange[0]} to ${cfg.notRecommendedRange[1]}`].filter(Boolean).join(", ");

// One number setting: label, slider and typed value. cfg comes from data/*.json (min, max, step, recommendedRange, notRecommendedRange).
// o = { label, cfg, help, get(), set(v),
//   live()    after every change (slider move or typed value), commit() when the value is final (slider released or value typed),
//   clamp()   true = typed values are kept inside min..max (Basic mode), note: text under the row,
//   hidden(), off()   hide the row / grey it out, lockSlider() true = only typing works (stage 1 Advanced),
//   bounds()  moving slider range [min, max], rate(v) colour class of the value (default rateOf), digits: rounding of the shown value }
// Returns { el, refresh }: put refresh in the stage's refresh list.
export function numberRow(o) {
  const cfg = o.cfg, d = el("div", "row"), l = el("label", "", o.label);
  const r = Object.assign(el("input"), { type: "range", min: cfg.min, max: cfg.max, step: cfg.step });
  const n = Object.assign(el("input"), { type: "number", step: cfg.step });
  if (o.help) l.append(help(o.help));
  d.append(l, r, n); if (o.note) d.append(el("div", "rec", o.note));
  const shown = (v) => (o.digits == null ? v : Math.round(v * 10 ** o.digits) / 10 ** o.digits);
  const change = (v) => { o.set(v); o.live?.(); };
  r.oninput = () => { if (!o.off?.()) change(+r.value); };
  r.onchange = () => { if (!o.off?.()) o.commit?.(); };
  n.onchange = () => {
    let v = +n.value;
    if (n.value === "" || isNaN(v) || o.off?.()) return refresh();
    if (o.clamp?.()) { const [lo, hi] = o.bounds ? o.bounds() : [cfg.min, cfg.max]; v = Math.min(hi, Math.max(lo, v)); }
    change(v); o.commit?.();
  };
  function refresh() {
    d.style.display = o.hidden?.() ? "none" : "";
    d.classList.toggle("off", !!o.off?.());
    const v = shown(o.get()); if (!Number.isFinite(v)) return; // greyed-out rows keep showing their value when they have one
    if (o.bounds) { const [lo, hi] = o.bounds(); r.min = lo; r.max = hi; }
    r.value = n.value = v; r.disabled = !!o.lockSlider?.();
    n.className = o.rate ? o.rate(v) : rateOf(cfg, v);
  }
  return { el: d, refresh };
}

// Tab status (✔ / ⚠ on each tab) and the Next button at the bottom of the side panel.
// checks = { stage: () => null when done, or a short text of what is missing }; stages without a check show nothing.
export function initSteps(checks) {
  const spans = [...document.querySelectorAll("#steps span[data-s]")], box = document.getElementById("next");
  const hint = el("div", "warn"), bNext = el("button");
  box.append(hint, bNext); spans.forEach((s) => s.append(el("span", "st")));
  let stage = "A", last = "";
  const paint = () => {
    const res = Object.fromEntries(spans.map((s) => [s.dataset.s, checks[s.dataset.s]?.()]));
    const key = JSON.stringify(res) + stage; if (key === last) return; last = key;
    spans.forEach((s) => { const r = res[s.dataset.s], i = s.lastChild; i.textContent = r === undefined ? "" : r ? "⚠" : "✔"; i.className = "st " + (r ? "warn" : "ok"); s.title = r || ""; });
    const n = spans[spans.findIndex((s) => s.dataset.s === stage) + 1];
    hint.textContent = res[stage] ? "⚠ " + res[stage] : "";
    bNext.style.display = n ? "" : "none";
    if (n) { bNext.textContent = "Next → " + n.firstChild.textContent; bNext.onclick = () => { n.click(); document.getElementById("side").scrollTop = 0; }; }
  };
  document.addEventListener("stage", (e) => { stage = e.detail; paint(); });
  setInterval(paint, 500); // the checks are cheap getters; this catches results that arrive later from the workers
  paint();
}

// Advanced switch: sits under the tabs, shows the state of the current stage. Stages listen to the "advanced" event.
const ADV_STAGES = ["A", "C", "D"]; // stages that have advanced settings (stage B has none, so the switch is hidden there)
export function initAdvanced(host) {
  const on = Object.fromEntries(ADV_STAGES.map((s) => [s, false]));
  let stage = "A";
  const sw = toggle("Advanced mode", (v) => { on[stage] = v; document.dispatchEvent(new CustomEvent("advanced", { detail: { stage, on: v } })); }, "advanced");
  host.append(sw.el);
  const show = () => { host.style.display = stage in on ? "" : "none"; if (stage in on) sw.set(on[stage]); };
  document.addEventListener("stage", (e) => { stage = e.detail; show(); });
  show();
}
