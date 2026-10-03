// Public-site interactions run in both the connected pilot and static preview.
const steps = [...document.querySelectorAll('.journey-step')];
const nodes = [...document.querySelectorAll('.route-node')];
const route = document.querySelector('.route-active');
const label = document.querySelector('#diagram-label');
const labels = [
  '01 · School request created',
  '02 · Payer reviews the details',
  '03 · Test value held',
  '04 · Afremit verifies test release'
];

function showStep(index) {
  if (!route || !label || !steps[index]) return;
  steps.forEach((step, i) => step.classList.toggle('active', i === index));
  nodes.forEach((node, i) => node.classList.toggle('active', i <= index));
  route.style.strokeDashoffset = String(985 - index * 290);
  label.textContent = labels[index];
}

const year = document.querySelector('#year');
if (year) year.textContent = String(new Date().getFullYear());

if (steps.length && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) showStep(Number(entry.target.dataset.step));
    });
  }, { rootMargin: '-30% 0px -45% 0px' });
  steps.forEach(step => observer.observe(step));
}
