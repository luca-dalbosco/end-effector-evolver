// Footer links (bottom-right). Edit the text and URLs in the two blocks below.

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
  steps: [
    'Pick your robot flange (tab 1 Robot side).',
    'Upload your part as a STEP file, or add a simple shape (tab 2 Tool).',
    'Click the faces to connect and choose Bridge or Voxel (tab 3 Connector).',
    'Press Generate.',
    'Export and print (tab 4 Export).',
  ],
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
  border-radius:8px;padding:20px;background:Canvas;color:CanvasText;
  font:14px/1.5 system-ui,sans-serif}
dialog.footer-dialog::backdrop{background:#0008}
dialog.footer-dialog h2{margin:0 0 10px;font-size:18px}
dialog.footer-dialog button{margin-top:12px;margin-right:6px;cursor:pointer}
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

  // Welcome pop-up: page 1 = welcome + video, page 2 = the 5 steps. "Don't show again" is ticked by default (first visit only).
  const store = (v) => { try { v === undefined ? null : localStorage.setItem(WELCOME_KEY, v); return localStorage.getItem(WELCOME_KEY); } catch (e) { return null; } };
  function openWelcome(page = 1) {
    const last = page === 2;
    const body = last
      ? `<h2>The 5 steps</h2><ol>${WELCOME.steps.map((s) => `<li>${s}</li>`).join('')}</ol>`
      : `<h2>Welcome</h2>${WELCOME.intro}<p>${WELCOME.video ? `<a href="${WELCOME.video}" target="_blank" rel="noopener">▶ Watch the intro video</a>` : '▶ Intro video: coming soon.'}</p>`;
    dialog.innerHTML = `${body}<div class="wel-foot"><label><input type="checkbox" id="wel-hide"> Don't show again</label>${last ? '<button id="wel-back">Back</button>' : '<button id="wel-skip">Skip</button>'}<button id="wel-next">${last ? 'Done' : 'Next →'}</button></div>`;
    const hide = dialog.querySelector('#wel-hide'); hide.checked = openWelcome.hide ?? true;
    hide.onchange = () => { openWelcome.hide = hide.checked; };
    const close = () => dialog.close();
    dialog.querySelector('#wel-next').onclick = () => (last ? close() : openWelcome(2));
    if (last) dialog.querySelector('#wel-back').onclick = () => openWelcome(1);
    else dialog.querySelector('#wel-skip').onclick = close;
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
      a.addEventListener('click', () => openWelcome(1));
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
  if (store() !== '1') openWelcome(1); // first visit
}
