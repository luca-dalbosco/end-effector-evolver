// Tutorial steps: animated line-art scene + 3 readouts + one line of text. Edit texts here.
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
const cyl = (cx, y, rx, h, c) => `<g stroke="${c}"><path d="M${cx - rx} ${y}v${h}a${rx} ${rx * .38} 0 0 0 ${2 * rx} 0v${-h}" fill="${c}" fill-opacity=".12"/><ellipse cx="${cx}" cy="${y}" rx="${rx}" ry="${rx * .38}" fill="${c}" fill-opacity=".3"/></g>`;
const arrowH = (x1, x2, y, c) => { const s = x2 > x1 ? -1 : 1; return `<path d="M${x1} ${y}H${x2}M${x2 + s * 6} ${y - 4}L${x2} ${y}L${x2 + s * 6} ${y + 4}" stroke="${c}" stroke-width="2"/>`; };

// Voxel Y-shape for step 4 (cells computed, so they line up)
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

export const TUTORIAL_STEPS = [
  {
    title: 'Robot side',
    pill: 'Robot side',
    text: 'Pick your robot and flange, then adjust the tool start: plate, screws, spigot and tolerances.',
    html: scene(`
      <rect x="132" y="12" width="56" height="44" rx="7" fill="currentColor" fill-opacity=".08"/>${lbl(160, 38, 'robot', 'currentColor')}
      <rect x="116" y="56" width="88" height="10" rx="2" fill="currentColor" fill-opacity=".15"/>
      <path d="M72 61H112" stroke-dasharray="3 3" opacity=".6"/>${lbl(68, 64, 'flange', 'currentColor', 'end')}
      <g class="tv-drop" ${d(.3)}><rect x="100" y="76" width="120" height="14" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/><rect x="146" y="90" width="28" height="8" fill="${B}" fill-opacity=".25" stroke="${B}"/></g>
      <g class="tv-rise" ${d(.9)} stroke-width="2.5"><path d="M124 68v26M196 68v26"/><path d="M119 98h10M191 98h10"/></g>
      <g class="tv-pop" ${d(1.4)}><path d="M224 83H250" stroke="${B}" stroke-dasharray="3 3"/>${lbl(254, 86, 'tool start', B, 'start')}</g>
      <g class="tv-pop" ${d(1.7)} opacity=".7">${lbl(160, 130, 'plate · screws · spigot')}</g>`, 'flange selected, tool start added'),
    strip: strip([['ROBOT', 'pick'], ['FLANGE', 'pick'], ['PLATE', 'adjust']]),
  },
  {
    title: 'Tool',
    pill: 'Tool',
    text: 'Upload a STEP file or add simple shapes. Move and rotate them until they sit where you want.',
    html: scene(`
      <rect x="70" y="22" width="180" height="10" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/>${lbl(160, 17, 'tool start', B)}
      <g class="tv-pop" ${d(.2)}>${box(86, 86, 64, 50, 26, O, { topOp: .35 })}${lbl(112, 152, 'STEP part', O)}</g>
      <g class="tv-slide" ${d(.8)}>${cyl(224, 92, 24, 44, O)}${lbl(224, 152, 'primitive', O)}</g>
      <g class="tv-pop" ${d(1.5)}>${arrowH(278, 258, 108, 'currentColor')}${lbl(268, 98, 'move')}</g>
      <path d="M92 70Q112 54 140 64" stroke-dasharray="70" stroke-dashoffset="70" class="tv-draw" ${d(1.9)}/>${lbl(116, 52, 'rotate')}`, 'move and rotate until it fits'),
    strip: strip([['PART', 'STEP · shape'], ['MOVE', 'X Y Z'], ['ROTATE', 'degrees']]),
  },
  {
    title: 'Connect and avoid',
    pill: 'Faces',
    text: 'Click the faces the connector must reach (green). Mark faces to avoid (red) and whole objects to avoid (dashed).',
    html: scene(`
      ${box(70, 82, 74, 56, 32, 'currentColor', { top: G, topOp: .55, side: R, sideOp: .45 })}
      <path d="M70 82l32-19h74l-32 19z" stroke="${G}" stroke-width="2.5" class="tv-pulse"/>
      <path d="M144 82l32-19v56l-32 19z" stroke="${R}" stroke-width="2.5" class="tv-pop" ${d(.7)}/>
      <g class="tv-pop" ${d(1.3)}>${box(218, 92, 44, 40, 20, R, { dash: 1, nofill: 1 })}<path d="M222 98l36 28M258 98l-36 28" stroke="${R}" stroke-width="1" opacity=".6"/></g>
      ${lbl(108, 50, 'connect face', G)}<path d="M108 54V68" stroke="${G}" stroke-dasharray="2 3"/>
      ${lbl(184, 158, 'avoid face', R)}<path d="M168 150L160 128" stroke="${R}" stroke-dasharray="2 3"/>
      ${lbl(246, 76, 'avoid object', R)}`, 'green connect, red keep clear'),
    strip: strip([['CONNECT', 'faces'], ['AVOID', 'faces'], ['AVOID', 'objects']]),
  },
  {
    title: 'Generate',
    pill: 'Generate',
    text: 'Split screen. Left: Bridge makes an instant solid wrap. Right: Voxel grows an optimised structure, then Refine smooths it.',
    html: scene(`
      <rect x="8" y="6" width="150" height="152" rx="8" opacity=".35"/><rect x="162" y="6" width="150" height="152" rx="8" opacity=".35"/>
      ${lbl(83, 22, 'BRIDGE')}${lbl(237, 22, 'VOXEL  +  REFINE')}
      <rect x="30" y="36" width="106" height="8" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/><rect x="60" y="126" width="46" height="12" rx="2" fill="${O}" fill-opacity=".4" stroke="${O}"/>
      <path d="M34 44C40 80 54 100 62 126H104C112 100 126 80 132 44Z" fill="currentColor" fill-opacity=".22" class="tv-pop" ${d(.4)}/>
      <rect x="190" y="36" width="100" height="8" rx="2" fill="${B}" fill-opacity=".4" stroke="${B}"/><rect x="220" y="126" width="40" height="12" rx="2" fill="${O}" fill-opacity=".4" stroke="${O}"/>
      <g stroke="none" fill="currentColor">${vox.map(([x, y], i) => `<rect class="tv-pop vx" ${d(.2 + i * .035)} x="${x}" y="${y}" width="7" height="7" fill-opacity=".5"/>`).join('')}</g>
      <path d="${Y}" transform="translate(0 4)" fill="currentColor" fill-opacity=".18" class="tv-pop" ${d(2.2)}/>`, 'bridge is instant, voxel optimises then refines'),
    strip: strip([['BRIDGE', 'instant'], ['VOXEL', 'optimise'], ['REFINE', 'smooth']]),
  },
  {
    title: 'Export and print',
    pill: 'Export',
    text: 'Export the connector as STL or 3MF (tab 4 Export), then 3D print it.',
    html: scene(`
      <g transform="translate(-60 10) scale(.55)" style="transform-box:view-box;transform-origin:0 0"><g class="tv-pop" ${d(.1)}><path d="${Y}" fill="currentColor" fill-opacity=".25"/><path d="M190 44H290" stroke="${B}" stroke-width="5"/><path d="M228 126H252" stroke="${O}" stroke-width="5"/></g></g>
      ${lbl(72, 100, 'connector')}
      ${arrowH(100, 128, 66, B)}
      <g class="tv-pop" ${d(.7)}><path d="M138 38h30l12 12v40h-42z" fill="currentColor" fill-opacity=".08"/><path d="M168 38v12h12"/>${lbl(159, 76, 'STL')}</g>
      ${arrowH(196, 224, 66, B)}
      <path d="M232 28h76M236 28v100M304 28v100" opacity=".5"/>
      <path d="M232 128h76" stroke-width="2"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect class="tv-pop" ${d(1 + i * .3)} x="${254 + i}" y="${118 - i * 7}" width="${34 - i * 2}" height="6" fill="currentColor" fill-opacity=".45" stroke="none"/>`).join('')}
      <g class="tv-nozzle" stroke="${O}"><path d="M262 38v14l-4 6h12l-4-6V38" fill="${O}" fill-opacity=".4"/></g>
      ${lbl(270, 148, '3D printer')}`, 'STL or 3MF out, layers up'),
    strip: strip([['FORMAT', 'STL · 3MF'], ['SCOPE', 'connector'], ['PRINT', 'ready']]),
  },
];
