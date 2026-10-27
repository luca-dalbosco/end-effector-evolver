// Tool start geometry generator.
// Coordinates: Z axis = flange axis. z = 0 is the plate face that touches the robot.
// The spigot, collar and printed pin extend toward the robot (negative z).
// The screw access face is at z = t (away from the robot).
import opencascade from "replicad-opencascadejs";
import { setOC, draw, makeCylinder } from "replicad";
import ts from "../../data/toolStart.json";

let ready = false;
export async function initKernel(opts) {
  if (ready) return;
  const OC = await opencascade(opts);
  setOC(OC);
  ready = true;
}

// Socket head cap screws (ISO 4762): head diameter and height per thread, from data/toolStart.json
const sc = ts.screwClearance;
const SCREW_HEADS = Object.fromEntries(Object.keys(sc.headDiameterByScrew).map((m) => [m, { d: sc.headDiameterByScrew[m], h: sc.headHeightByScrew[m] }]));
const HEAD_MARGIN = sc.headDiameterMargin;
const MIN_REMAINING = sc.rules.minRemainingMaterial;
const EPS = 1e-9;
const KEY_OVERLAP = 0.5; // how far a key sinks into the wall or plate so it fuses cleanly

// used when a setting is missing; every value comes from data/toolStart.json
const TOL = ts.tolerances;
export const DEFAULT_SETTINGS = {
  fitMode: ts.fitMode.default, // plate | plate-spigot | plate-spigot-collar
  thickness: ts.thickness.default,
  tolerances: Object.fromEntries(Object.entries(TOL).filter(([, v]) => typeof v === "object").map(([k, v]) => [k, v.default])),
  plateMargin: ts.plateEdgeMargin.default,
  spigotStyle: ts.spigotStyle.default,
  wallKeys: ts.wallKeys.default, // keys that fit the flange wall pockets
  dowelMode: ts.dowel.mode.default, // hole | printedPin
  headSeat: sc.headSeat.default, // none | countersink | counterbore
  headDiameter: null, // null = head diameter + margin
  seatLength: null, // null = counterbore: min(head height, t - min remaining material)
  chamfer: { robotFacing: ts.chamfer.robotFacing.default, awayFacing: ts.chamfer.awayFacing.default, size: ts.chamfer.size.default },
};

// replicad booleans do not free their inputs (OpenCascade memory is not garbage collected): these do.
const cutBy = (body, tool) => { const r = body.cut(tool); body.delete(); tool.delete(); return r; };
const fuseWith = (body, tool) => { const r = body.fuse(tool); body.delete(); tool.delete(); return r; };
const keepIn = (body, tool) => { const r = body.intersect(tool); body.delete(); tool.delete(); return r; };

function cyl(diameter, z0, z1, x = 0, y = 0) {
  return makeCylinder(diameter / 2, z1 - z0, [x, y, z0], [0, 0, 1]);
}

// Screw hole angles: from the pattern (count, startAngleDeg, spacingDeg), or from an explicit anglesDeg list (older local flanges).
export function holeAngles(h) {
  if (Array.isArray(h.anglesDeg)) return h.anglesDeg;
  return Array.from({ length: h.count }, (_, i) => +(h.startAngleDeg + i * h.spacingDeg).toFixed(4));
}

// Wall keys: one small cylinder per pocket in the flange wall, so the printed part locks into them.
// kind "spigot": pockets are in the flange centre hole wall, keys stick OUT of the spigot wall (wallR = spigot outer radius).
// kind "collar": pockets are in the flange raised spigot wall, keys stick IN from the collar wall (wallR = collar inner radius).
function addWallKeys(body, pockets, kind, wallR, tol, depth, warnings) {
  const keyD = pockets.diameter - 2 * tol;
  const len = Math.min(depth, pockets.depth - tol);
  const pr = pockets.pitchCircleDiameter / 2;
  const reach = kind === "spigot" ? pr + keyD / 2 - wallR : wallR - (pr - keyD / 2);
  if (keyD <= 0 || len <= 0 || reach <= EPS) {
    warnings.push(`Wall keys for the ${kind} were skipped: the pockets do not reach the printed wall or are too small for the tolerance.`);
    return { body, n: 0 };
  }
  const dir = pockets.direction === "counterclockwise" ? 1 : -1; // seen from the tool side (+Z)
  const trimR = kind === "spigot" ? wallR - KEY_OVERLAP : wallR + KEY_OVERLAP;
  for (let i = 0; i < pockets.count; i++) {
    const a = (dir * (pockets.startAngleDeg + i * pockets.spacingDeg) * Math.PI) / 180;
    let key = cyl(keyD, -len, KEY_OVERLAP, pr * Math.cos(a), pr * Math.sin(a));
    const ring = cyl(2 * trimR, -len - 1, 1);
    key = kind === "spigot" ? cutBy(key, ring) : keepIn(key, ring);
    body = fuseWith(body, key);
  }
  return { body, n: pockets.count };
}

// Wall flats: the flange raised spigot has a straight flat (a chord of `width`). The collar gets a matching key
// (the circle segment beyond the flat, pulled back by the collar tolerance), so the part only fits one way round.
function addWallFlats(body, flats, spigotR, collarR, tol, depth, warnings) {
  const dist = Math.sqrt(spigotR * spigotR - (flats.width / 2) ** 2) + tol; // flat distance from the axis, plus clearance
  if (!(flats.width > 0) || flats.width >= 2 * spigotR || depth <= 0 || collarR - dist <= EPS) {
    warnings.push("The wall flat key was skipped: the flat does not reach the printed collar.");
    return { body, n: 0 };
  }
  const half = collarR + 1;
  let key = draw([dist, -half]).lineTo([half, -half]).lineTo([half, half]).lineTo([dist, half]).close().sketchOnPlane("XY", -depth).extrude(depth + KEY_OVERLAP);
  key = keepIn(key, cyl(2 * (collarR + KEY_OVERLAP), -depth - 1, 1));
  key = key.rotate(flats.angleDeg ?? 0, [0, 0, 0], [0, 0, 1]);
  return { body: fuseWith(body, key), n: 1 };
}

// Revolve a closed (r, z) profile around the Z axis.
function revolveProfile(points) {
  const pts = points.filter(
    (p, i) =>
      i === 0 ||
      Math.abs(p[0] - points[i - 1][0]) > EPS ||
      Math.abs(p[1] - points[i - 1][1]) > EPS
  );
  let pen = draw(pts[0]);
  for (let i = 1; i < pts.length; i++) pen = pen.lineTo(pts[i]);
  return pen.close().sketchOnPlane("XZ").revolve([0, 0, 1]);
}

export function buildToolStart(flange, userSettings = {}) {
  const s = {
    ...DEFAULT_SETTINGS,
    ...userSettings,
    tolerances: { ...DEFAULT_SETTINGS.tolerances, ...(userSettings.tolerances || {}) },
    chamfer: { ...DEFAULT_SETTINGS.chamfer, ...(userSettings.chamfer || {}) },
  };
  const c = s.chamfer.size;
  const chRobot = !!s.chamfer.robotFacing;
  const chAway = !!s.chamfer.awayFacing;
  const g = flange.geometry;
  const t = s.thickness;
  const warnings = [];
  const errors = [];
  const hasSpigot = s.fitMode !== "plate";
  const hasCollar = s.fitMode === "plate-spigot-collar";
  const hasCentre = !!g.centreHole, hasRaised = !!g.raisedSpigot, hasPin = !!g.locatingPin;
  if (hasSpigot && !(hasCentre && g.centreHole.depth > 0)) errors.push("This flange has no centre hole depth, so Plate + Spigot is not available.");
  if (hasCollar && !hasRaised) errors.push("This flange has no raised spigot, so the collar is not available.");
  if (s.fitMode === "plate" && s.dowelMode === "printedPin" && hasPin)
    errors.push("A printed dowel is not allowed in Plate mode: Plate prints flat from its base without supports.");
  if (!hasRaised && !g.outerDiameter) errors.push("Flange needs an outer diameter.");
  const tol = s.tolerances;

  const th = ts.thickness, rng = (v, r) => v >= r[0] && v <= r[1];
  if (t < th.min || t > th.max) errors.push(`Thickness must be between ${th.min} and ${th.max} mm.`);
  if (t < th.recommendedRange[0]) warnings.push(`Thickness below ${th.recommendedRange[0]} mm is not recommended.`);
  if ((chRobot || chAway) && t < 3 * c - EPS)
    errors.push(`Thickness too small for ${c} mm chamfers (minimum ${+(3 * c).toFixed(2)} mm).`);

  const screw = g.threadedHoles.thread; // e.g. "M5"
  const M = parseFloat(screw.slice(1));
  const head = SCREW_HEADS[screw];
  if (!head) errors.push(`No ISO 4762 head data for ${screw}.`);
  const holeD = M + 2 * tol.screwHole;
  const headD = s.headDiameter ?? (head ? head.d + HEAD_MARGIN : holeD);
  const bad = TOL.screwHole.notRecommendedRange;
  if (rng(tol.screwHole, bad)) warnings.push(`Screw hole tolerance ${bad[0]} to ${bad[1]} is not recommended.`);

  // Head seat rules
  let seat = { type: s.headSeat, length: 0, proud: 0 };
  if (s.headSeat === "counterbore") {
    seat.length = s.seatLength ?? Math.min(head.h, t - MIN_REMAINING);
    if (seat.length <= 0) errors.push("Thickness too small for a counterbore (needs 1 mm of material under it).");
    if (seat.length > t - MIN_REMAINING + EPS) errors.push("Counterbore leaves less than 1 mm of material.");
    seat.proud = Math.max(0, head.h - seat.length);
    if (seat.proud > 0)
      warnings.push(`${seat.proud.toFixed(2)} mm of the socket head would stand proud due to your selected thickness.`);
  } else if (s.headSeat === "countersink") {
    seat.length = (headD - holeD) / 2; // 90 degree countersink
    if (t - seat.length < MIN_REMAINING - EPS)
      errors.push("Less than 1 mm of material would remain under the countersink. Increase the thickness.");
  }

  // Spigot / collar / depth
  const spigotOuter = hasCentre ? g.centreHole.diameter - 2 * tol.spigot : 0;
  const full = s.spigotStyle === "full";
  const bore = full ? 0 : spigotOuter - 2 * t;
  const collarInner = hasRaised ? g.raisedSpigot.diameter + 2 * tol.collar : 0;
  const collarOuter = collarInner + 2 * t;
  const baseDepth = Math.min(g.centreHole?.depth ?? Infinity, g.raisedSpigot?.height ?? Infinity);
  const tolsUsed = [];
  if (hasSpigot) tolsUsed.push(tol.spigot);
  if (hasCollar) tolsUsed.push(tol.collar);
  const depth = baseDepth - (tolsUsed.length ? Math.max(...tolsUsed) : 0);
  if (hasSpigot && !full && bore <= 0) errors.push("Thickness too large: the spigot bore would close completely.");
  const recS = TOL.spigot.recommendedRange, recC = TOL.collar.recommendedRange;
  if (hasSpigot && !rng(tol.spigot, recS)) warnings.push(`Spigot tolerance outside the recommended ${recS[0]} to ${recS[1]} mm.`);
  if (hasCollar && !rng(tol.collar, recC)) warnings.push(`Collar tolerance outside the recommended ${recC[0]} to ${recC[1]} mm.`);

  // Plate outer diameter
  let plateOuter = g.raisedSpigot?.diameter ?? g.outerDiameter ?? 0;
  if (hasCollar) plateOuter = Math.max(plateOuter, collarOuter);
  const pcdR = g.pitchCircleDiameter / 2;
  // Always sized for an Allen screw head, whether or not a seat is cut. Chamfers need extra room.
  const margin = s.plateMargin + (chAway ? 2 * c : 0);
  plateOuter = Math.max(plateOuter, 2 * (pcdR + headD / 2 + margin));

  // Screw arrangement check (closest pair of screw centres)
  const angles = holeAngles(g.threadedHoles);
  let minGap = Infinity;
  for (let i = 0; i < angles.length; i++)
    for (let j = i + 1; j < angles.length; j++) {
      const a = (angles[i] * Math.PI) / 180, b = (angles[j] * Math.PI) / 180;
      const d = Math.hypot(pcdR * (Math.cos(a) - Math.cos(b)), pcdR * (Math.sin(a) - Math.sin(b)));
      minGap = Math.min(minGap, d);
    }
  if (s.headSeat !== "none" && headD >= minGap)
    errors.push("Neighbouring screw head cylinders would overlap.");

  if (errors.length) return { ok: false, errors, warnings };

  // Axisymmetric body in one revolve (no booleans). Corners flagged "ch" are convex corners
  // that receive a 45 degree chamfer (robot-facing or away-facing planar faces only).
  const rb = (hasSpigot ? bore : full ? 0 : g.centreHole?.diameter ?? 0) / 2; // Plate + Full = closed plate
  const rs = spigotOuter / 2;
  const rp = plateOuter / 2;
  const rci = collarInner / 2, rco = collarOuter / 2;
  const V = [];
  if (hasSpigot) {
    V.push({ p: [rb, -depth], ch: chRobot && rb > EPS }, { p: [rs, -depth], ch: chRobot }, { p: [rs, 0], ch: false });
    if (hasCollar) {
      V.push({ p: [rci, 0], ch: false }, { p: [rci, -depth], ch: chRobot }, { p: [rco, -depth], ch: chRobot });
      if (rp > rco + EPS) V.push({ p: [rco, 0], ch: false }, { p: [rp, 0], ch: chRobot });
    } else {
      V.push({ p: [rp, 0], ch: chRobot });
    }
  } else {
    V.push({ p: [rb, 0], ch: chRobot && rb > EPS }, { p: [rp, 0], ch: chRobot });
  }
  V.push({ p: [rp, t], ch: chAway }, { p: [rb, t], ch: chAway && rb > EPS });

  const pts = [];
  V.forEach((v, i) => {
    if (!v.ch) return pts.push(v.p);
    const A = V[(i + V.length - 1) % V.length].p, B = V[(i + 1) % V.length].p;
    const unit = (Q) => {
      const dx = Q[0] - v.p[0], dz = Q[1] - v.p[1], L = Math.hypot(dx, dz);
      return [dx / L, dz / L, L];
    };
    const ua = unit(A), ub = unit(B);
    if (ua[2] < c - EPS || ub[2] < c - EPS) errors.push(`An edge is too short for the ${c} mm chamfer.`);
    pts.push([v.p[0] + c * ua[0], v.p[1] + c * ua[1]], [v.p[0] + c * ub[0], v.p[1] + c * ub[1]]);
  });
  if (errors.length) return { ok: false, errors, warnings };
  let body = revolveProfile(pts);
  const profile = pts;

  // Wall keys (before the screw holes, so any overlap gets cut away)
  let keyCount = 0;
  if (s.wallKeys && hasSpigot) {
    const jobs = [];
    if (g.centreHole?.wallPockets) jobs.push([g.centreHole.wallPockets, "spigot", rs, tol.spigot]);
    if (hasCollar && g.raisedSpigot?.wallPockets) jobs.push([g.raisedSpigot.wallPockets, "collar", rci, tol.collar]);
    for (const [pk, kind, wallR, tl] of jobs) {
      const r = addWallKeys(body, pk, kind, wallR, tl, depth, warnings);
      body = r.body;
      keyCount += r.n;
    }
    if (hasCollar && g.raisedSpigot?.wallFlats) {
      const r = addWallFlats(body, g.raisedSpigot.wallFlats, g.raisedSpigot.diameter / 2, rci, tol.collar, depth, warnings);
      body = r.body;
      keyCount += r.n;
    }
  }

  // Cutters for chamfered hole edges
  const coneAway = (r, zFace, x, y) =>
    revolveProfile([[0, zFace - c - 0.5], [r - 0.5, zFace - c - 0.5], [r + c, zFace], [r + c, zFace + 0.5], [0, zFace + 0.5]]).translate([x, y, 0]);
  const coneRobot = (r, x, y) =>
    revolveProfile([[0, c + 0.5], [r - 0.5, c + 0.5], [r + c, 0], [r + c, -0.5], [0, -0.5]]).translate([x, y, 0]);
  const chamferCuts = []; // removed ring sections, for the test's analytic check: [radius, count]

  // Screw holes and head seats
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    const x = pcdR * Math.cos(a), y = pcdR * Math.sin(a);
    body = cutBy(body, cyl(holeD, -1, t + 1, x, y));
    if (s.headSeat === "counterbore") {
      body = cutBy(body, cyl(headD, t - seat.length, t + 1, x, y));
      if (chAway) {
        body = cutBy(body, coneAway(headD / 2, t, x, y));
        body = cutBy(body, coneAway(holeD / 2, t - seat.length, x, y));
        chamferCuts.push(headD / 2, holeD / 2);
      }
    } else if (s.headSeat === "countersink") {
      const cone = revolveProfile([
        [0, t - seat.length], [holeD / 2, t - seat.length], [headD / 2, t], [headD / 2, t + 1], [0, t + 1],
      ]).translate([x, y, 0]);
      body = cutBy(body, cone);
    } else if (chAway) {
      body = cutBy(body, coneAway(holeD / 2, t, x, y));
      chamferCuts.push(holeD / 2);
    }
    if (chRobot) {
      body = cutBy(body, coneRobot(holeD / 2, x, y));
      chamferCuts.push(holeD / 2);
    }
  }

  // Dowel (present in every fit mode)
  let pinLength = null;
  const dowelD = hasPin ? g.locatingPin.diameter + 2 * tol.dowelHole : 0;
  const pinSpots = (g.locatingPin?.anglesDeg ?? [0]).map((deg) => [pcdR * Math.cos((deg * Math.PI) / 180), pcdR * Math.sin((deg * Math.PI) / 180)]); // one dowel at 0° unless anglesDeg lists more
  if (!hasPin) {
    pinLength = 0;
  } else if (s.dowelMode === "hole") {
    for (const [x, y] of pinSpots) {
      body = cutBy(body, cyl(dowelD, -1, t + 1, x, y));
      if (chAway) { body = cutBy(body, coneAway(dowelD / 2, t, x, y)); chamferCuts.push(dowelD / 2); }
      if (chRobot) { body = cutBy(body, coneRobot(dowelD / 2, x, y)); chamferCuts.push(dowelD / 2); }
    }
  } else {
    const pinDepth = hasSpigot ? depth : baseDepth;
    pinLength = Math.min(pinDepth - tol.dowelPin, g.locatingPin.depth - tol.dowelPin);
    const pr = (g.locatingPin.diameter - 2 * tol.dowelPin) / 2;
    const pinPts = chRobot
      ? [[0, -pinLength], [pr - c, -pinLength], [pr, -pinLength + c], [pr, t / 2], [0, t / 2]]
      : [[0, -pinLength], [pr, -pinLength], [pr, t / 2], [0, t / 2]];
    for (const [x, y] of pinSpots) body = fuseWith(body, revolveProfile(pinPts).translate([x, y, 0]));
    warnings.push("Printed pin is not recommended: weaker and less accurate than a metal dowel.");
  }

  return {
    ok: true,
    shape: body,
    warnings,
    errors,
    dims: { plateOuter, plateThickness: t, holeD, headD, seat, spigotOuter: hasSpigot ? spigotOuter : null,
            bore: hasSpigot ? bore : null, hasPin, collarInner: hasCollar ? collarInner : null,
            collarOuter: hasCollar ? collarOuter : null, depth: hasSpigot ? depth : null, pinLength, centreHole: hasSpigot ? null : 2 * rb,
            dowelD, keyCount, profile, chamferCuts, chamfer: { robot: chRobot, away: chAway, size: c },
            screws: { pcdR, angles, headH: head ? head.h : 0 } },
  };
}
