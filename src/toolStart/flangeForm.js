// "+ Add custom flange…": a dialog for a robot flange that is not in data/flanges.json. Saved only in this browser.
// open() shows it; onSave(flange) gets the new flange; onCancel() runs when it is closed without saving.
export function initFlangeForm(threads, onSave, onCancel) {
  const fields = [["brand", "Brand (optional, e.g. KUKA)", "text"], ["name", "Model name (e.g. My robot)", "text"], ["pcd", "Pitch circle diameter", "number"], ["thread", "Screw thread", threads.join(",")], ["threadDepth", "Thread depth", "number"],
    ["positions", "Number of hole positions on the circle", "number"], ["pinD", "Locating pin hole diameter (empty = no pin; it takes position 0)", "number?"], ["pinDepth", "Pin hole depth", "number?"],
    ["spigotD", "Raised spigot diameter (empty = none)", "number?"], ["spigotH", "Raised spigot height", "number?"], ["centreD", "Centre hole diameter (empty = none)", "number?"], ["centreDepth", "Centre hole depth", "number?"],
    ["outerD", "Flange outer diameter (needed when there is no raised spigot)", "number?"]];
  const dlg = document.createElement("dialog"); dlg.innerHTML = "<b>Create local robotic flange</b><div id='ff'></div><div id='fe' class='bad'></div><button id='fs'>Save</button><button id='fc'>Cancel</button>"; document.body.append(dlg);
  const $ = (id) => document.getElementById(id);
  $("ff").innerHTML = fields.map(([k, l, t]) => `<label>${l}${t.includes(",") ? `<select id="f_${k}">${t.split(",").map((o) => `<option>${o}</option>`).join("")}</select>` : `<input id="f_${k}" type="${t.startsWith("number") ? "number" : "text"}" step="any">`}</label>`).join("");
  $("f_thread").value = "M5"; // the common robot flange screw
  const fv = (k) => $("f_" + k).value, fn = (k) => (fv(k) === "" ? null : +fv(k));
  $("fc").onclick = () => { dlg.close(); onCancel(); };
  $("fs").onclick = () => {
    const pos = fn("positions"), pin = fn("pinD") != null, need = ["pcd", "threadDepth", "positions"].filter((k) => !(fn(k) > 0));
    if (!fv("name") || need.length || (!fn("spigotD") && !fn("outerD")) || (pin && !(fn("pinDepth") > 0)) || (fn("spigotD") && !(fn("spigotH") > 0)) || (fn("centreD") && !(fn("centreDepth") > 0)))
      return ($("fe").textContent = "Please fill name, pitch circle, thread depth, positions, the depths of the features you use, and either a spigot or an outer diameter.");
    const step = 360 / pos, count = pos - (pin ? 1 : 0);
    const geometry = { pitchCircleDiameter: fn("pcd"), threadedHoles: { count, thread: fv("thread"), threadDepth: fn("threadDepth"), startAngleDeg: pin ? step : 0, spacingDeg: step } };
    if (pin) geometry.locatingPin = { diameter: fn("pinD"), depth: fn("pinDepth"), angleDeg: 0 };
    if (fn("spigotD")) geometry.raisedSpigot = { diameter: fn("spigotD"), height: fn("spigotH") };
    if (fn("centreD")) geometry.centreHole = { diameter: fn("centreD"), depth: fn("centreDepth") };
    if (fn("outerD")) geometry.outerDiameter = fn("outerD");
    dlg.close();
    onSave({ id: "custom-" + Date.now(), brand: fv("brand").trim() ? fv("brand").trim() + " (Custom)" : "Custom", custom: true, model: fv("name"), geometry });
  };
  return () => { $("fe").textContent = ""; dlg.showModal(); };
}
