// Stage D: Export. Pick what goes in the file, the format and the mesh resolution. The geometry engine (worker.js) writes the file.
import ex from "../data/export.json";

export function initExport({ worker, $, list, toolEnd, toolConnect, getStart, getFlangeId }) {
  const S = { scope: ex.scope.default, withStart: ex.withToolStart.default, withEnd: ex.withToolEnd.default, format: ex.format.default, res: ex.resolution.default, tol: ex.toleranceMm.default, ang: ex.angleDeg.default };
  let advanced = false, busy = false, xid = 0;
  const el = (tag, text = "", css = "") => { const e = document.createElement(tag); e.textContent = text; e.style.cssText = css; return e; };
  const head = (t) => el("div", t, "font-weight:700;margin:14px 0 4px");
  const note = (t) => { const d = el("div", t); d.className = "rec"; return d; };
  const labelled = (input, text, css = "display:block;margin:4px 0") => { const l = el("label", "", css); l.append(input, " " + text); return l; };
  const selectOf = (opts, onchange) => { const s = el("select"); opts.forEach((o) => s.add(new Option(o.label, o.id))); s.onchange = () => { onchange(s.value); refresh(); }; return s; };
  const numberOf = (cfg, set) => { const n = Object.assign(el("input"), { type: "number", min: cfg.min, max: cfg.max, step: cfg.step }); n.style.width = "90px"; n.onchange = () => { const v = +n.value; if (n.value !== "" && v > 0) { set(v); S.res = "custom"; } refresh(); }; return n; };

  const panel = el("div"); panel.style.display = "none"; $("exportA").after(panel);

  // what to export
  const radios = ex.scope.options.map((o) => { const r = Object.assign(el("input"), { type: "radio", name: "exScope", value: o.id }); r.onchange = () => { S.scope = o.id; refresh(); }; panel.append(labelled(r, o.label)); return r; });
  const optBox = el("div", "", "margin:0 0 6px 22px");
  const cStart = Object.assign(el("input"), { type: "checkbox" }), cEnd = Object.assign(el("input"), { type: "checkbox" });
  cStart.onchange = () => { S.withStart = cStart.checked; refresh(); }; cEnd.onchange = () => { S.withEnd = cEnd.checked; refresh(); };
  optBox.append(labelled(cStart, "Include the tool start"), labelled(cEnd, "Include the tool end (the part the connector joins)"));
  radios[1].parentElement.after(optBox);
  const sum = el("div", "", "font-size:12px;line-height:1.5;margin:8px 0");
  panel.append(sum);

  // format and resolution
  panel.append(head("File format"));
  const fmt = selectOf(ex.format.options, (v) => (S.format = v)), stepOpt = [...fmt.options].find((o) => o.value === "step");
  const fmtNote = note("");
  panel.append(fmt, fmtNote);
  const resBox = el("div"); resBox.append(head("Mesh resolution"));
  const resSel = selectOf(ex.resolution.options, (v) => { const o = ex.resolution.options.find((x) => x.id === v); S.res = v; S.tol = o.toleranceMm; S.ang = o.angleDeg; });
  const customOpt = new Option("Custom (typed below)", "custom"); customOpt.disabled = true; resSel.add(customOpt);
  const resNote = note("Applies to the tool start and the tool end. The connector is already a mesh, it is written as you see it.");
  const advBox = el("div", "", "margin-top:6px");
  const tolIn = numberOf(ex.toleranceMm, (v) => (S.tol = v)), angIn = numberOf(ex.angleDeg, (v) => (S.ang = v));
  advBox.append(labelled(tolIn, "Max deviation (mm)", "display:block;margin:4px 0"), note(ex.toleranceMm.note), labelled(angIn, "Max angle (°)", "display:block;margin:4px 0"), note(ex.angleDeg.note));
  resBox.append(resSel, resNote, advBox);
  panel.append(resBox);
  const cAdv = Object.assign(el("input"), { type: "checkbox" }); cAdv.onchange = () => { advanced = cAdv.checked; refresh(); };
  panel.append(labelled(cAdv, "Advanced mode (type any value)", "display:block;margin:10px 0 4px"));

  const bGo = el("button", "Export"); bGo.onclick = go; bGo.style.cssText = "margin-top:12px;padding:8px 18px;font-weight:700";
  const out = el("div", "", "font-size:12px;line-height:1.5;margin-top:8px");
  panel.append(bGo, out);
  const say = (cls, text) => { out.innerHTML = ""; const d = el("div", text); d.className = cls; out.append(d); };

  // what is in the file
  function collect() {
    const res = toolConnect.getResult(), endObj = toolEnd.getPart();
    const parts = list.items().filter((i) => i.sid != null); // tool-end parts and every other object the user added
    const role = (i) => (i.object === endObj ? " (tool end)" : toolConnect.isAvoided(i) ? " (avoid)" : "");
    const part = (i, tag) => ({ name: i.name + (tag ? role(i) : ""), src: "part", sid: i.sid, pos: i.object.position.toArray(), rot: [i.object.rotation.x, i.object.rotation.y, i.object.rotation.z] });
    const start = { name: "Tool start", src: "start" }, conn = res && { name: "Connector", src: "mesh", v: res.p, t: res.i };
    const items = [], notes = [];
    if (S.scope === "start") {
      if (!getStart()) return { error: "The tool start is not built yet." };
      items.push(start);
    } else if (S.scope === "tool") {
      if (!conn) return { error: "No connector yet. Make one in step 3 (Generate)." };
      if (S.withStart) items.push(start);
      items.push(conn);
      if (S.withEnd) { const e = parts.find((i) => i.object === endObj); if (e) items.push(part(e, false)); else notes.push("There is no tool end part to include."); }
    } else {
      if (getStart()) items.push(start);
      if (conn) items.push(conn); else notes.push("No connector yet (step 3), so it is left out.");
      parts.forEach((i) => items.push(part(i, true)));
    }
    return { items, notes };
  }
  const baseName = (items) => (S.scope === "start" ? `tool_start_${getFlangeId()}` : S.scope === "all" ? "end_effector" : items.length === 1 ? "connector" : "tool");

  function refresh() {
    radios.forEach((r) => (r.checked = r.value === S.scope));
    optBox.style.display = S.scope === "tool" ? "" : "none";
    cStart.checked = S.withStart; cEnd.checked = S.withEnd; cAdv.checked = advanced;
    fmt.value = S.format; resSel.value = S.res; customOpt.hidden = S.res !== "custom";
    resBox.style.display = S.format === "step" ? "none" : "";
    advBox.style.display = advanced ? "" : "none"; tolIn.value = S.tol; angIn.value = S.ang;
    fmtNote.textContent = S.format === "step"
      ? "Exact CAD faces for the tool start and the tool end. The connector is a mesh, so STEP is not available while it is in the file."
      : S.format === "3mf" ? "One file. Every object stays a separate object inside it." : "One file for one object. With several objects you get a .zip with one STL each.";
    const c = collect(), hasConn = !!c.items?.some((i) => i.src === "mesh");
    if (hasConn && S.format === "step") S.format = ex.format.default; // the connector is a mesh: no STEP
    stepOpt.disabled = hasConn; fmt.value = S.format;
    sum.innerHTML = c.error ? `<span class="warn">⚠ ${c.error}</span>` : `<b>In the file (${c.items.length}):</b> ${c.items.map((i) => i.name).join(", ")}` + c.notes.map((n) => `<br><span class="warn">⚠ ${n}</span>`).join("");
    bGo.disabled = busy || !!c.error || !c.items.length;
  }

  function go() {
    const c = collect(); if (c.error || !c.items.length || busy) return;
    busy = true; refresh(); say("", "Writing the file…"); $("status").textContent = "Exporting…";
    worker.postMessage({ type: "exportScene", xid: ++xid, format: S.format, tol: S.tol, ang: (S.ang * Math.PI) / 180, items: c.items, base: baseName(c.items) });
  }
  worker.addEventListener("message", (e) => {
    const m = e.data; if (!m.exportedScene || m.xid !== xid) return;
    busy = false; $("status").textContent = "Ready"; refresh();
    if (!m.ok) return say("bad", "✖ " + m.error);
    const url = URL.createObjectURL(new Blob([m.data])), a = Object.assign(document.createElement("a"), { href: url, download: m.file });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    out.innerHTML = "";
    const d = el("div", `✔ ${m.file}: ${m.info.objects} object(s), ${m.info.tris ? m.info.tris.toLocaleString() + " triangles" : "exact CAD faces"}, ${(m.info.bytes / 1048576).toFixed(m.info.bytes > 1048576 ? 1 : 2)} MB`); d.className = "ok"; out.append(d);
  });

  document.addEventListener("stage", (e) => { const on = e.detail === "D"; panel.style.display = on ? "" : "none"; if (on) { out.innerHTML = ""; refresh(); } });
  refresh();
}
