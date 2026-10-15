// Tutorial steps: animated line-art scene + 3 readouts + a short text. Edit texts here.
// Every scene has the robot flange at the BOTTOM and the tool end on top.
// Colours follow the app: blue = tool start, orange = tool end, green = connect, red = avoid, grey = result.
// Animations (tv-*) live in the CSS of footerLinks.js. Strokes use currentColor, so light/dark both work.
const B = '#4a7fb5', O = '#d98c3f', G = '#2ecc71', R = '#e53935';
const d = (s) => `style="animation-delay:${s}s"`;
const scene = (inner, caption) => `<div class="tv-scene"><svg viewBox="0 0 320 180" width="100%" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" font-family="system-ui,sans-serif" font-size="9.5" aria-hidden="true">${inner}<text x="160" y="173" fill="currentColor" stroke="none" text-anchor="middle" opacity=".55">${caption}</text></svg></div>`;
const strip = (a) => `<div class="tv-strip">${a.map(([k, v]) => `<span><small>${k}</small>${v}</span>`).join('')}</div>`;
const lbl = (x, y, s, c = 'currentColor', a = 'middle') => `<text x="${x}" y="${y}" fill="${c}" stroke="none" text-anchor="${a}" font-weight="600">${s}</text>`;
// isometric box: front face top-left (x,y), width w, height h, depth k. c = colour (default grey).
const box = (x, y, w, h, k, c = 'currentColor', o = {}) => {
  const s = o.dash ? ` stroke-dasharray="4 3"` : '', f = o.nofill ? 0 : 1, t = k * .6;
  return `<g stroke="${c}"${s}>
  <path d="M${x} ${y}h${w}v${h}h${-w}z" fill="${c}" fill-opacity="${.12 * f}"/>
  <path d="M${x} ${y}l${k} ${-t}h${w}l${-k} ${t}z" fill="${o.top || c}" fill-opacity="${(o.topOp ?? .3) * f}"/>
  <path d="M${x + w} ${y}l${k} ${-t}v${h}l${-k} ${t}z" fill="${o.side || c}" fill-opacity="${(o.sideOp ?? .06) * f}"/></g>`;
};
const arrowH = (x1, x2, y, c) => { const s = x2 > x1 ? -1 : 1; return `<path d="M${x1} ${y}H${x2}M${x2 + s * 6} ${y - 4}L${x2} ${y}L${x2 + s * 6} ${y + 4}" stroke="${c}" stroke-width="2"/>`; };
// two-finger gripper, fingers pointing up. (x,y) = top-left of the body, 64 wide.
const gripper = (x, y, c) => `<g stroke="${c}" fill="${c}" fill-opacity=".22"><rect x="${x}" y="${y}" width="64" height="30" rx="3"/><rect x="${x + 4}" y="${y - 36}" width="12" height="36"/><rect x="${x + 48}" y="${y - 36}" width="12" height="36"/><rect x="${x + 16}" y="${y - 36}" width="6" height="9"/><rect x="${x + 42}" y="${y - 36}" width="6" height="9"/></g>`;

// Voxel shape for step 4 (cells computed, so they line up). Drawn flange-down by the group transform.
const vox = (() => {
  const out = [];
  for (let r = 0; r < 8; r++) {
    const f = r / 7, xl = 190 + 36 * f, xi = 218 + 20 * f;
    for (let x = xl; x < xi - 3; x += 8) { out.push([Math.round(x), 44 + r * 8]); out.push([480 - Math.round(x) - 8, 44 + r * 8]); }
  }
  for (let r = 0; r < 2; r++) for (const x of [228, 236, 244]) out.push([x, 108 + r * 8]);
  return out;
})();
const Y = 'M190 44H218C226 70 232 84 240 96C248 84 254 70 262 44H290C284 84 266 98 252 110V126H228V110C214 98 196 84 190 44Z';
// Y flipped so the flange (wide) side is at the bottom: an inverted V with a stem on top
const YF = 'M190 126H218C226 100 232 86 240 74C248 86 254 100 262 126H290C284 86 266 72 252 60V44H228V60C214 72 196 86 190 126Z';
// printed connector for step 5: two legs on the bed (inverted V), meeting in a stem on top. Same outline as Y.
const layers = Array.from({ length: 10 }, (_, i) => {
  const s = i * 82 / 9, k = .6, g = Math.max(0, 22 * (1 - s / 52)), o = 50 - 38 * Math.min(1, s / 66);
  const c = i === 0 ? B : i === 9 ? O : 'currentColor', y = 121 - i * 6;
  const r = (x, w) => `<rect class="tv-pop" ${d(1 + i * .25)} x="${x}" y="${y}" width="${w}" height="5.5" fill="${c}" fill-opacity=".5" stroke="none"/>`;
  return g > 1 ? r(270 - o * k, (o - g) * k) + r(270 + g * k, (o - g) * k) : r(270 - o * k, 2 * o * k);
}).join('');

export const TUTORIAL_STEPS = [
  {
    title: 'Robot side',
    pill: 'Robot side',
    text: 'Choose your robot and its flange type. The tool start is the plate that bolts onto the flange: adjust its screws, spigot and tolerances.',
    html: scene(`<g transform="translate(40 22) scale(.75)" style="transform-box:view-box;transform-origin:0 0">
      <rect x="132" y="130" width="56" height="34" rx="7" fill="currentColor" fill-opacity=".08"/>${lbl(160, 151, 'robot', 'currentColor')}
      <rect x="116" y="118" width="88" height="10" rx="2" fill="currentColor" fill-opacity=".15"/>
      <path d="M72 123H112" stroke-dasharray="3 3" opacity=".6"/>${lbl(68, 126, 'flange', 'currentColor', 'end')}
      <g class="tv-drop" ${d(.3)}><rect x="100" y="98" width="120" height="14" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/><rect x="146" y="112" width="28" height="8" fill="${B}" fill-opacity=".25" stroke="${B}"/></g>
      <g class="tv-rise" ${d(.9)} stroke-width="2.5"><path d="M124 130V104M196 130V104"/><path d="M119 131h10M191 131h10"/></g>
      <g class="tv-pop" ${d(1.4)}><path d="M224 105H250" stroke="${B}" stroke-dasharray="3 3"/>${lbl(254, 108, 'tool start', B, 'start')}</g>
      <g class="tv-pop" ${d(1.7)} opacity=".7">${lbl(160, 80, 'plate · screws · spigot')}</g></g>`, 'flange selected, tool start added'),
    strip: strip([['ROBOT', 'select'], ['FLANGE', 'select type'], ['TOLERANCES', 'adjust']]),
  },
  {
    title: 'Tool',
    pill: 'Tool',
    text: 'Bring in the part your robot will carry (a gripper, a linear actuator…) as a STEP file, or add simple shapes. Move and rotate it to where it should sit relative to the flange.',
    html: scene(`
      <rect x="100" y="140" width="120" height="10" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/>${lbl(160, 164, 'tool start', B)}
      <g class="tv-pop" ${d(.2)}>${gripper(84, 80, O)}${lbl(116, 99, 'STEP part', O)}</g>
      <g class="tv-slide" ${d(.8)}>${box(176, 102, 36, 30, 16, O, { topOp: .35 })}${lbl(194, 86, 'primitive', O)}</g>
      <g class="tv-pop" ${d(1.5)}>${arrowH(278, 252, 118, 'currentColor')}${lbl(265, 108, 'move')}</g>
      <path d="M76 40Q100 22 134 34" stroke-dasharray="70" stroke-dashoffset="70" class="tv-draw" ${d(1.9)}/>${lbl(105, 18, 'rotate')}`, 'move and rotate until it fits'),
    strip: strip([['PART', 'STEP · primitive'], ['MOVE', 'X Y Z mm'], ['ROTATE', 'degrees']]),
  },
  {
    title: 'Preparation',
    pill: 'Preparation',
    text: 'Click the faces of your part where the connector may attach (green). Mark faces (red) or whole objects (dashed red) it must stay clear of. The tool start stays visible as a reference.',
    html: scene(`
      <rect x="100" y="140" width="120" height="10" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/>${lbl(160, 164, 'tool start (reference)', B)}
      ${gripper(100, 62, 'currentColor')}
      <rect x="100" y="62" width="64" height="30" rx="3" fill="${G}" fill-opacity=".45" stroke="${G}" stroke-width="2.5" class="tv-pulse"/>
      <rect x="148" y="26" width="12" height="36" fill="${R}" fill-opacity=".5" stroke="${R}" stroke-width="2.5" class="tv-pop" ${d(.7)}/>
      <path d="M120 138V94" stroke="${G}" stroke-dasharray="3 3" stroke-width="2"/>
      <g class="tv-pop" ${d(1.3)}>${box(150, 116, 40, 18, 14, R, { dash: 1, nofill: 1 })}<path d="M154 118l32 14M186 118l-32 14" stroke="${R}" stroke-width="1" opacity=".6"/></g>
      ${lbl(52, 80, 'connect face', G)}<path d="M88 78H98" stroke="${G}" stroke-dasharray="2 3"/>
      ${lbl(184, 30, 'avoid face', R, 'start')}<path d="M182 32L162 42" stroke="${R}" stroke-dasharray="2 3"/>
      ${lbl(214, 130, 'avoid object', R, 'start')}`, 'green connect, red keep clear'),
    strip: strip([['CONNECT', 'faces'], ['AVOID', 'faces'], ['AVOID', 'objects']]),
  },
  {
    title: 'Generate',
    pill: 'Generate',
    text: 'Left: Bridge makes an instant solid wrap between flange and part. Right: Voxel grows a lighter, optimised structure, then Refine smooths it for printing.',
    html: scene(`
      <rect x="8" y="6" width="150" height="152" rx="8" opacity=".35"/><rect x="162" y="6" width="150" height="152" rx="8" opacity=".35"/>
      ${lbl(83, 22, 'BRIDGE')}${lbl(237, 22, 'VOXEL  +  REFINE')}
      <rect x="30" y="130" width="106" height="8" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/><rect x="60" y="36" width="46" height="12" rx="2" fill="${O}" fill-opacity=".4" stroke="${O}"/>
      <path d="M34 130C40 94 54 74 62 48H104C112 74 126 94 132 130Z" fill="currentColor" fill-opacity=".22" class="tv-pop" ${d(.4)}/>
      <rect x="190" y="130" width="100" height="8" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/><rect x="220" y="36" width="40" height="12" rx="2" fill="${O}" fill-opacity=".4" stroke="${O}"/>
      <g stroke="none" fill="currentColor">${vox.map(([x, y], i) => `<rect class="tv-pop vx" ${d(.2 + i * .035)} x="${x}" y="${167 - y}" width="7" height="7" fill-opacity=".5"/>`).join('')}</g>
      <g transform="translate(0 4)"><path d="${YF}" fill="currentColor" fill-opacity=".18" class="tv-pop" ${d(2.2)}/></g>`, 'bridge is instant, voxel optimises then refines'),
    strip: strip([['BRIDGE', 'instant'], ['VOXEL', 'optimisation'], ['REFINE', 'smoothing']]),
  },
  {
    title: 'Export and print',
    pill: 'Export',
    text: 'In tab 5 Export, choose what to export, then save the connector as STL or 3MF and 3D print it. The flat flange side sits on the print bed.',
    html: scene(`
      <g transform="translate(-60 103.2) scale(.55 -.55)" style="transform-box:view-box;transform-origin:0 0"><g class="tv-pop" ${d(.1)}><path d="${Y}" fill="currentColor" fill-opacity=".25"/><path d="M190 44H290" stroke="${B}" stroke-width="5"/><path d="M228 126H252" stroke="${O}" stroke-width="5"/></g></g>
      ${lbl(72, 100, 'connector')}
      ${arrowH(100, 128, 66, B)}
      <g class="tv-pop" ${d(.7)}><path d="M138 38h30l12 12v40h-42z" fill="currentColor" fill-opacity=".08"/><path d="M168 38v12h12"/>${lbl(159, 76, 'STL')}</g>
      ${arrowH(196, 224, 66, B)}
      <path d="M232 28h76M236 28v100M304 28v100" opacity=".5"/>
      <path d="M232 128h76" stroke-width="2"/>
      ${layers}
      <g class="tv-nozzle" stroke="${O}"><path d="M262 38v14l-4 6h12l-4-6V38" fill="${O}" fill-opacity=".4"/></g>
      ${lbl(270, 148, '3D printer')}`, 'STL or 3MF out, layers up'),
    strip: strip([['CHOOSE', 'what to export'], ['FORMAT', 'STL · 3MF'], ['PRINT', 'ready']]),
  },
  {
    title: 'Test it!',
    pill: 'Test it!',
    text: 'The tool is yours. Mount your printed connector, test it, try to break it, then share your results and suggestions so the tool can get better.',
    html: scene(`
      <path d="M20 160H300" opacity=".4"/>
      <rect x="120" y="148" width="80" height="12" rx="2" fill="currentColor" fill-opacity=".15"/>${lbl(90, 158, 'robot', 'currentColor', 'end')}
      <g class="tv-arm1" style="transform-box:view-box;transform-origin:160px 148px">
        <rect x="152" y="96" width="16" height="54" rx="4" fill="currentColor" fill-opacity=".12"/>
        <circle cx="160" cy="98" r="8" fill="currentColor" fill-opacity=".2"/>
        <g class="tv-arm2" style="transform-box:view-box;transform-origin:160px 98px">
          <rect x="156" y="90" width="76" height="16" rx="4" fill="currentColor" fill-opacity=".12"/>
          <rect x="218" y="106" width="24" height="5" fill="currentColor" fill-opacity=".3"/>
          <rect x="220" y="111" width="20" height="6" fill="${B}" fill-opacity=".45" stroke="${B}"/>
          <path d="M222 117H238L234 130H226Z" fill="currentColor" fill-opacity=".3"/>
          <rect x="220" y="130" width="20" height="8" fill="${O}" fill-opacity=".45" stroke="${O}"/>
          <rect x="218" y="138" width="7" height="14" fill="${O}" fill-opacity=".3" stroke="${O}"/><rect x="235" y="138" width="7" height="14" fill="${O}" fill-opacity=".3" stroke="${O}"/>
        </g>
      </g>
      `, 'mount, test, tell us how it went'),
    strip: strip([['TEST', 'it'], ['BREAK', 'it'], ['SEND', 'feedback']]),
  },
];
