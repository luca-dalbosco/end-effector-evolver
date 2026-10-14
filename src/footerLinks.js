// Footer links (bottom-right). Edit the text and URLs in the two blocks below.
import { TUTORIAL_STEPS } from './tutorialSteps.js';

const LINKS = {
  donate: 'https://www.buymeacoffee.com/YOUR-NAME',      // <- put your real link
  source: 'https://github.com/luca-dalbosco/end-effector-evolver',      // <- repo link
  contact: 'mailto:YOUR-EMAIL@example.com',              // <- or a form URL later
};

// Third-party libraries (from npm). Edit freely.
const LIBS = [
  { name: 'three.js', licence: 'MIT', url: 'https://github.com/mrdoob/three.js',
    by: 'mrdoob and contributors', what: '3D view' },
  { name: 'Replicad', licence: 'MIT', url: 'https://github.com/sgenoud/replicad',
    by: 'Steve Genoud', what: 'CAD geometry in the browser' },
  { name: 'replicad-opencascadejs (Open CASCADE)', licence: 'LGPL-2.1',
    url: 'https://dev.opencascade.org',
    by: 'Open CASCADE SAS, web build by Steve Genoud', what: 'geometry engine' },
  { name: 'opentype.js', licence: 'MIT', url: 'https://github.com/opentypejs/opentype.js',
    by: 'Frederik De Bleser and contributors', what: 'font reading' },
  { name: 'fflate', licence: 'MIT', url: 'https://github.com/101arrowz/fflate',
    by: 'Arjun Barrett', what: 'compression' },
  { name: 'Flatbush', licence: 'ISC', url: 'https://github.com/mourner/flatbush',
    by: 'Vladimir Agafonkin', what: 'fast spatial search' },
  { name: 'FlatQueue', licence: 'ISC', url: 'https://github.com/mourner/flatqueue',
    by: 'Vladimir Agafonkin', what: 'priority queue' },
  { name: 'tiny-inflate', licence: 'MIT', url: 'https://github.com/devongovett/tiny-inflate',
    by: 'Devon Govett', what: 'decompression' },
  { name: 'String.prototype.codePointAt', licence: 'MIT',
    url: 'https://github.com/mathiasbynens/String.prototype.codePointAt',
    by: 'Mathias Bynens', what: 'text helper' },
];

// Welcome pop-up (first visit, and the footer "Tutorial" link). Edit the texts here.
const WELCOME = {
  video: '', // <- put the intro video URL here (empty = shows "coming soon")
  intro: `<p>Welcome! This tool builds a 3D-printable connector between your robot flange and your own part.</p>
    <p>Everything runs in your browser. Nothing is uploaded.</p>`,
};
const WELCOME_KEY = 'welcomeHide'; // localStorage: '1' = do not open on start

// Pop-up pages. Plain HTML inside the backticks.
const PAGES = {
  about: {
    title: 'About',
    html: `<p>End Effector Evolver creates a 3D-printable connector
      between a robot flange and your own part.</p>
      <p>Everything runs in your browser. Nothing is uploaded.</p>`,
  },
    licence: {
    title: 'Licence',
    html: `<p><strong>End Effector Evolver</strong><br>
      Copyright © 2026 Luca Dalbosco and contributors</p>
      <p>This is free software, released under the
      <strong>GNU General Public License v3.0</strong>.</p>
      <p><strong>You can:</strong> use it for any purpose, study how it works,
      change it, and share it.</p>
      <p><strong>You must:</strong> keep the copyright notice and this licence,
      and if you share a modified version, release it under the same licence
      with its source code available.</p>
      <p>The parts you generate with this tool are yours.</p>
      <p>This program comes with <strong>no warranty</strong>, to the extent
      permitted by law. See the licence for details.</p>
      <p>Robot brand and model names belong to their owners. This project is not affiliated with them.
      Flange data is taken from public manufacturer datasheets or uploaded by users.</p>
      <p>
        <a href="${LINKS.source}/blob/main/LICENSE" target="_blank" rel="noopener">Full licence text (GitHub)</a><br>
        <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noopener">GNU GPL v3.0 on gnu.org</a>
      </p>`,
  },
    credits: {
    title: 'Credits',
    html: `<p>Thank you to the people who build and share the open-source
      tools this project stands on.</p>
      <ul>${LIBS.map(l => `<li><a href="${l.url}" target="_blank" rel="noopener">${l.name}</a>
        · ${l.licence}<br><small>${l.what} · by ${l.by}</small></li>`).join('')}</ul>
      <p><small>Open CASCADE is licensed under LGPL 2.1 with an exception. You can
      get its source code and licence from the links above.</small></p>`,
  },
  privacy: {
    title: 'Privacy Notice',
    html: `<p>This tool runs 100% in your browser. Your files and settings
      never leave your computer. We have no server, no accounts, no
      tracking and no cookies.</p>
      <p>If you use the contact link, your email app sends the message,
      and it is handled like any normal email.</p>`,
  },
  terms: {
    title: 'Terms and Conditions',
    html: `<p>This tool is provided "as is", without warranty of any kind.
      You are responsible for checking every generated part before
      printing or mounting it on a robot. The author is not liable for
      damage, injury or loss resulting from its use.</p>
      <p>Flange data comes from manufacturer datasheets. Always verify
      against the official drawing.</p>`,
  },
};

// Links shown in the corner. "page" opens a pop-up, "href" opens a new tab.
const ITEMS = [
  { label: 'About', page: 'about' },
  { label: 'Tutorial', action: 'welcome' },
  { label: 'Donate ☕', href: LINKS.donate },
  { label: 'Licence', page: 'licence' },
  { label: 'Credits', page: 'credits' },
  { label: 'Privacy', page: 'privacy' },
  { label: 'Terms', page: 'terms' },
  { label: 'Source', href: LINKS.source },
  { label: 'Contact', href: LINKS.contact },
];

const CSS = `
.footer-links{position:fixed;right:12px;bottom:8px;z-index:50;display:flex;
  flex-wrap:wrap;justify-content:flex-end;gap:4px 12px;max-width:60vw;
  font:12px system-ui,sans-serif;opacity:.7}
.footer-links:hover{opacity:1}
.footer-links a{color:inherit;text-decoration:none;cursor:pointer}
.footer-links a:hover{text-decoration:underline}
dialog.footer-dialog{max-height:80vh;overflow:auto;max-width:480px;width:90vw;border:1px solid #8884;
  border-radius:8px;padding:20px;background:var(--bg,Canvas);color:var(--fg,CanvasText);
  font:14px/1.5 system-ui,sans-serif}
dialog.footer-dialog::backdrop{background:#0008}
dialog.footer-dialog h2{margin:0 0 10px;font-size:18px}
dialog.footer-dialog button{margin-top:12px;margin-right:6px;cursor:pointer}
dialog.footer-dialog[data-welcome="1"]{max-width:560px}
.tv-scene{background:var(--chip,#2b2c30);border:1px solid var(--line,#3a3b3f);border-radius:8px;padding:6px}
.tv-strip{display:flex;margin:6px 0 10px;border:1px solid var(--line,#3a3b3f);border-radius:6px;font:12px ui-monospace,monospace}
.tv-strip span{flex:1;padding:6px 8px;text-align:center}.tv-strip span+span{border-left:1px solid var(--line,#3a3b3f)}
.tv-strip small{display:block;opacity:.5;font-size:9px;letter-spacing:.08em}
.tv-pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tv-pill{font-size:11px;padding:3px 9px;border:1px solid #8886;border-radius:99px;opacity:.55;cursor:pointer}
.tv-pill.on{opacity:1;border-color:#2f7de1;background:#2f7de122}
.tv-scene svg *{transform-box:fill-box;transform-origin:center}
.tv-drop{animation:tv-drop .6s ease-out both}.tv-slide{animation:tv-slide .7s ease-out both}
.tv-pop{animation:tv-pop .4s ease-out both}.tv-pulse{animation:tv-pulse 1.4s ease-in-out infinite}
.tv-draw{animation:tv-draw 1.2s ease-out both}.tv-rise{animation:tv-rise .6s ease-out both}
.tv-nozzle{animation:tv-noz 2.4s ease-in-out 1s infinite alternate}
@keyframes tv-rise{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes tv-noz{from{transform:translateX(-16px)}to{transform:translateX(16px)}}
@keyframes tv-drop{from{transform:translateY(-28px);opacity:0}to{transform:none;opacity:1}}
@keyframes tv-slide{from{transform:translateX(60px);opacity:0}to{transform:none;opacity:1}}
@keyframes tv-pop{from{transform:scale(.6);opacity:0}to{transform:none;opacity:1}}
@keyframes tv-pulse{50%{opacity:.35}}
@keyframes tv-draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.tv-scene svg *{animation:none!important}}
dialog.footer-dialog .wel-foot{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px}
dialog.footer-dialog .wel-foot label{margin-right:auto}
dialog.footer-dialog .wel-foot button{margin:0}
`;

export function initFooterLinks() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const dialog = document.createElement('dialog');
  dialog.className = 'footer-dialog';
  document.body.appendChild(dialog);
  // click on the dark backdrop closes the pop-up
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  // Welcome pop-up: page 0 = welcome + video, pages 1-5 = the tutorial steps with a diagram. "Don't show again" is ticked by default (first visit only).
  const store = (v) => { try { v === undefined ? null : localStorage.setItem(WELCOME_KEY, v); return localStorage.getItem(WELCOME_KEY); } catch (e) { return null; } };
  const N = TUTORIAL_STEPS.length;
  function openWelcome(page = 0) {
    const first = page === 0, last = page === N;
    const st = TUTORIAL_STEPS[page - 1];
    const body = first
      ? `<h2>Welcome</h2>${WELCOME.intro}<p>${WELCOME.video ? `<a href="${WELCOME.video}" target="_blank" rel="noopener">▶ Watch the intro video</a>` : '▶ Intro video: coming soon.'}</p>`
      : `<h2>${page} · ${st.title}</h2>${st.html}${st.strip}<p>${st.text}</p>`;
    const dots = TUTORIAL_STEPS.map((x, i) => `<a class="tv-pill${i + 1 === page ? ' on' : ''}" data-p="${i + 1}">${i + 1} ${x.pill}</a>`).join('');
    dialog.innerHTML = `${body}<div class="tv-pills">${dots}</div><div class="wel-foot"><label><input type="checkbox" id="wel-hide"> Don't show again</label>${first ? '<button id="wel-skip">Skip</button>' : '<button id="wel-back">Back</button>'}<button id="wel-next">${last ? 'Done' : 'Next →'}</button></div>`;
    const hide = dialog.querySelector('#wel-hide'); hide.checked = openWelcome.hide ?? true;
    hide.onchange = () => { openWelcome.hide = hide.checked; };
    const close = () => dialog.close();
    dialog.querySelectorAll('.tv-pill').forEach((p) => { p.onclick = () => openWelcome(+p.dataset.p); });
    dialog.querySelector('#wel-next').onclick = () => (last ? close() : openWelcome(page + 1));
    if (first) dialog.querySelector('#wel-skip').onclick = close;
    else dialog.querySelector('#wel-back').onclick = () => openWelcome(page - 1);
    dialog.dataset.welcome = '1';
    if (!dialog.open) dialog.showModal();
  }
  dialog.addEventListener('close', () => { if (dialog.dataset.welcome) store(openWelcome.hide === false ? '0' : '1'); dialog.dataset.welcome = ''; openWelcome.hide = undefined; }); // Esc and backdrop count too

  const nav = document.createElement('nav');
  nav.className = 'footer-links';
  for (const item of ITEMS) {
    const a = document.createElement('a');
    a.textContent = item.label;
    if (item.action === 'welcome') {
      a.addEventListener('click', () => openWelcome(0));
    } else if (item.href) {
      a.href = item.href;
      if (item.href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
    } else {
      a.addEventListener('click', () => {
        dialog.dataset.welcome = '';
        const p = PAGES[item.page];
        dialog.innerHTML = `<h2>${p.title}</h2>${p.html}<br><button>Close</button>`;
        dialog.querySelector('button').onclick = () => dialog.close();
        dialog.showModal();
      });
    }
    nav.appendChild(a);
  }
  document.body.appendChild(nav);
  if (store() !== '1') openWelcome(0); // first visit
}
