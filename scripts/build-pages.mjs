import { cp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';

const output = 'pages-dist';
await rm(output, { recursive: true, force: true });
await mkdir(output);
await cp('public', output, { recursive: true });

let html = await readFile(`${output}/index.html`, 'utf8');
const required = ['href="/styles.css"', 'src="/app.js"', 'href="#app"', '<span id="year"></span>'];
for (const value of required) {
  if (!html.includes(value)) throw new Error(`Static preview source changed: missing ${value}`);
}

// GitHub Pages project sites live below /<repository>/, so keep assets relative.
html = html.replaceAll('href="/assets/', 'href="./assets/');
html = html.replaceAll('src="/assets/', 'src="./assets/');
html = html.replace('href="/styles.css"', 'href="./styles.css"');
html = html.replaceAll('href="/#"', 'href="#"');

// The local and Cloudflare builds keep the working pilot. The Pages edition is
// an informational preview, so no button should open an API-dependent screen.
html = html.replaceAll('href="#app"', 'href="#pilot"');
html = html.replace('Open pilot <span aria-hidden="true">↗</span>', 'Explore the pilot <span aria-hidden="true">↗</span>');
html = html.replace('Explore the test pilot <span>↗</span>', 'Explore the pilot plan <span>↗</span>');
html = html.replace('Apply for a provider pilot <span>↗</span>', 'Learn about provider pilots <span>↗</span>');
html = html.replace('Open the guided pilot <span>↗</span>', 'Discuss a guided pilot <span>↗</span>');
html = html.replace('Open pilot</a>', 'Pilot overview</a>');
html = html.replace('Join as a provider <span>↗</span>', 'For providers <span>↗</span>');
html = html.replace('Try the education journey <span>↗</span>', 'Read the education example <span>↗</span>');
html = html.replace('href="#pilot">Discuss a guided pilot', 'href="https://www.linkedin.com/company/afremit/" rel="noopener noreferrer" target="_blank">Discuss a guided pilot');
html = html.replace('Afremit pilot · Open for guided testing · No real payments', 'Afremit concept preview · Guided tests by arrangement · No real payments');
html = html.replace('Providers can apply in the pilot workspace.', 'Providers can apply when the connected pilot workspace opens.');
html = html.replace('Public pilot registration will be available when the connected deployment is configured.', 'The interactive workspace requires a separate connected deployment.');
html = html.replace('Applications and pilot activity can involve real participants.', 'The connected pilot is designed for guided tests with consenting participants.');
html = html.replace('<span id="year"></span>', String(new Date().getFullYear()));
html = html.replace('  <div id="app-shell" hidden></div>\n  <script type="module" src="/app.js"></script>\n', '');
await writeFile(`${output}/index.html`, html);
await unlink(`${output}/app.js`);
await writeFile(`${output}/.nojekyll`, '');
console.log(`Built static GitHub Pages preview in ${output}/. The interactive pilot is excluded.`);
