import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('GitHub Pages preview keeps the public journey animation without the pilot app', async () => {
  await import('../scripts/build-pages.mjs');
  const html = await readFile('pages-dist/index.html', 'utf8');
  const script = await readFile('pages-dist/site.js', 'utf8');
  assert.match(html, /src="\.\/site\.js"/);
  assert.doesNotMatch(html, /src="\/app\.js"|id="app-shell"/);

  const element = dataset => ({ dataset, classList: { active: false, toggle(_name, value) { this.active = value; } } });
  const steps = Array.from({ length: 4 }, (_, index) => element({ step: String(index) }));
  const nodes = Array.from({ length: 4 }, () => element({}));
  const route = { style: {} }, label = { textContent: '' }, year = { textContent: '' };
  let observer;
  class IntersectionObserver {
    constructor(callback) { observer = { callback, targets: [] }; }
    observe(target) { observer.targets.push(target); }
  }
  const document = {
    querySelectorAll(selector) { return selector === '.journey-step' ? steps : nodes; },
    querySelector(selector) { return ({ '.route-active': route, '#diagram-label': label, '#year': year })[selector]; }
  };
  vm.runInNewContext(script, { document, window: { IntersectionObserver }, IntersectionObserver, Date });
  assert.equal(observer.targets.length, 4);
  observer.callback([{ target: steps[3], isIntersecting: true }]);
  assert.equal(label.textContent, '04 · Afremit verifies test release');
  assert.equal(route.style.strokeDashoffset, '115');
  assert.equal(steps[3].classList.active, true);
  assert.equal(nodes.every(node => node.classList.active), true);
});
