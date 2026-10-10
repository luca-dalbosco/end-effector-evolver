// Footer links (bottom-right). Edit the text and URLs in the two blocks below.

const LINKS = {
  donate: 'https://www.buymeacoffee.com/YOUR-NAME',      // <- put your real link
  source: 'https://github.com/luca-dalbosco/voxel-end-efector',      // <- repo link
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

// Pop-up pages. Plain HTML inside the backticks.
const PAGES = {
  about: {
    title: 'About',
    html: `<p>Robotic End-Effector Generator creates a 3D-printable connector
      between a robot flange and your own part.</p>
      <p>Everything runs in your browser. Nothing is uploaded.</p>`,
  },
  tutorial: {
    title: 'Tutorial',
    html: `<ol>
      <li>Pick your robot and design the tool start (A).</li>
      <li>Import your part and choose surfaces (B).</li>
      <li>Generate the connector (C).</li>
      <li>Export and print (D).</li>
    </ol><p>Tutorial coming soon.</p>`,
  },
    licence: {
    title: 'Licence',
    html: `<p><strong>Robotic End-Effector Generator</strong><br>
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
  { label: 'Tutorial', page: 'tutorial' },
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
dialog.footer-dialog button{margin-top:12px;cursor:pointer}
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

  const nav = document.createElement('nav');
  nav.className = 'footer-links';
  for (const item of ITEMS) {
    const a = document.createElement('a');
    a.textContent = item.label;
    if (item.href) {
      a.href = item.href;
      if (item.href.startsWith('http')) { a.target = '_blank'; a.rel = 'noopener'; }
    } else {
      a.addEventListener('click', () => {
        const p = PAGES[item.page];
        dialog.innerHTML = `<h2>${p.title}</h2>${p.html}<br><button>Close</button>`;
        dialog.querySelector('button').onclick = () => dialog.close();
        dialog.showModal();
      });
    }
    nav.appendChild(a);
  }
  document.body.appendChild(nav);
}