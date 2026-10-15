// The one load on the tool: payload weight × acceleration factor along a chosen direction, plus an optional extra force. Units: N.
export const GDIR = { "-X": [-1, 0, 0], "+X": [1, 0, 0], "-Y": [0, -1, 0], "+Y": [0, 1, 0], "-Z": [0, 0, -1], "+Z": [0, 0, 1] };
export const G = 9.81;

export function loadVector(gdir, massKg, accel, extra = [0, 0, 0]) {
  const g = GDIR[gdir] || GDIR["-Y"], m = massKg * accel * G;
  return [g[0] * m + extra[0], g[1] * m + extra[1], g[2] * m + extra[2]];
}
