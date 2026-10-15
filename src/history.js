// Undo / redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y) and the small action message next to the status ("Ready · Thickness: 8 → 10").
// Each action calls record(label, undo, redo) AFTER it was done. undo() / redo() run the functions and switch to the stage the change was made in.
const undos = [], redos = [], MAX = 100;
let stage = "A", busy = false, timer = null;
document.addEventListener("stage", (e) => { stage = e.detail; });

export function note(text) { // shown for a moment, behind the status text (CSS: #status[data-note]::after)
  const s = document.getElementById("status"); if (!s) return;
  s.dataset.note = text; clearTimeout(timer); timer = setTimeout(() => { delete s.dataset.note; }, 3000);
}
export const isReplaying = () => busy;

// dispose() (optional) frees what the entry holds when it falls off the stacks
export function record(label, undo, redo, dispose) {
  if (busy) return;
  redos.splice(0).forEach((e) => e.dispose?.());
  undos.push({ label, undo, redo, dispose, stage });
  if (undos.length > MAX) undos.shift().dispose?.();
  note(label);
}

function go(from, to, verb, fn) {
  const e = from.pop(); if (!e) return note("Nothing to " + verb.toLowerCase());
  const tab = document.querySelector(`#steps span[data-s="${e.stage}"]`);
  if (e.stage !== stage) tab?.click();
  busy = true;
  try { e[fn](); } finally { busy = false; }
  to.push(e); note(`${verb}: ${e.label}`);
}
export const undo = () => go(undos, redos, "Undo", "undo");
export const redo = () => go(redos, undos, "Redo", "redo");

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase(), t = e.target;
  if (k !== "z" && k !== "y") return;
  if (document.querySelector("dialog[open]") || (t.tagName === "INPUT" && t.type === "text") || t.tagName === "TEXTAREA") return; // text boxes keep their own undo
  e.preventDefault();
  if (t.tagName === "INPUT" || t.tagName === "SELECT") t.blur(); // a typed value is committed first, then undone
  (k === "y" || e.shiftKey ? redo : undo)();
});
