const $ = selector => document.querySelector(selector);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const title = { education: 'Education', healthcare: 'Healthcare', construction: 'Construction' };
const money = (amount, currency) => new Intl.NumberFormat('en', { style: 'currency', currency }).format(Number(amount) / (['XAF','XOF'].includes(currency) ? 1 : 100));
const date = value => new Date(value).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
const id = () => crypto.randomUUID();
const pill = value => `<span class="status-pill ${safe(value)}">${safe(value.replaceAll('_', ' '))}</span>`;
const notice = '<div class="notice"><strong>Test payments only.</strong> No funds move, no exchange quote is offered, and no payment is insured or guaranteed in this pilot.</div>';
let config = { demo: true }, profile = null, session = null, screen = 'overview', feedback = '';
let data = { applications: [], requests: [], payments: [], institutions: [], metrics: null };
const app = $('#app-shell'), site = $('#site');

async function init() {
  try { config = await (await fetch('/api/config')).json(); } catch { /* Show network error on pilot screen. */ }
  if (config.demo) session = { demo: localStorage.getItem('afremit-demo') || '' };
  else { try { session = JSON.parse(localStorage.getItem('afremit-session') || 'null'); } catch {} }
  $('#year').textContent = new Date().getFullYear();
  window.addEventListener('hashchange', route); route();
  const steps = [...document.querySelectorAll('.journey-step')];
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { entries.forEach(entry => { if (entry.isIntersecting) setStep(Number(entry.target.dataset.step)); }); }, { rootMargin: '-30% 0px -45% 0px' });
    steps.forEach(step => observer.observe(step));
  }
}
function setStep(n) {
  document.querySelectorAll('.journey-step').forEach((el, index) => el.classList.toggle('active', index === n));
  document.querySelectorAll('.route-node').forEach((el, index) => el.classList.toggle('active', index <= n));
  $('.route-active').style.strokeDashoffset = 985 - n * 290;
  $('#diagram-label').textContent = ['01 · School request created','02 · Payer reviews the details','03 · Test value held','04 · Afremit verifies test release'][n];
}
function authHeaders() { return config.demo ? { 'X-Demo-User': session?.demo || '' } : { Authorization: `Bearer ${session?.access_token || ''}` }; }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || 'The request could not be completed.');
  return value;
}
async function refreshAuth() {
  if (!session) return;
  if (!config.demo && session.expires_at && Date.now() / 1000 > session.expires_at - 60) {
    const response = await fetch(`${config.supabase_url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: config.anon_key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
    if (!response.ok) { signOut(); return; }
    session = await response.json(); session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
    localStorage.setItem('afremit-session', JSON.stringify(session));
  }
  profile = await api('me');
}
async function load() {
  await refreshAuth();
  if (!profile) return;
  const [applications, requests, payments, institutions] = await Promise.all([api('applications'), api('requests'), api('payments'), api('institutions')]);
  data = { applications, requests, payments, institutions, metrics: profile.role === 'admin' ? await api('admin/metrics') : null };
}
function signOut() { profile = null; session = null; localStorage.removeItem('afremit-session'); localStorage.removeItem('afremit-demo'); route(); }
async function route() {
  const hash = decodeURIComponent(location.hash || '');
  const inside = hash.startsWith('#app');
  site.hidden = inside; app.hidden = !inside;
  document.title = inside ? 'Afremit Pilot | Test environment' : 'Afremit | Support with purpose';
  if (!inside) return;
  screen = hash.slice(5).replace(/^\//, '').split('?')[0] || 'overview';
  app.innerHTML = '<div class="loading">Opening Afremit pilot…</div>';
  try { await load(); render(); } catch (error) { profile = null; feedback = error.message; render(); }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function setScreen(value) { location.hash = '#app/' + value; if (screen === value) route(); }
function flash(message, error = false) { feedback = `<div class="status-message ${error ? 'error-message' : ''}" role="status">${safe(message)}</div>`; render(); }

function render() {
  if (!profile) return renderLogin();
  const tabs = [['overview','Overview'],['applications','Provider onboarding'],['requests','Create requests'],['pay','Pay a request'],['transactions','Test transactions'],...(profile.role === 'admin' ? [['review','Team review']] : [])];
  app.innerHTML = `<header class="app-header"><a class="brand" href="/#"><img src="/assets/afremit-logo.png" width="52" height="52" alt=""><span>Afremit</span></a><div class="app-header-right"><span class="mode-badge">● TEST MODE</span><span class="muted">${safe(profile.name || profile.email)}</span><a href="/#">View site ↗</a><button class="inline-button" data-action="signout">Sign out</button></div></header><div class="app-layout"><aside class="app-sidebar"><div class="sidebar-caption">PILOT WORKSPACE</div>${tabs.map(([key,label]) => `<button data-screen="${key}" class="${screen === key ? 'active' : ''}">${label}<span>↗</span></button>`).join('')}<p class="sidebar-note">The local demo uses fictional records. Connected pilot accounts use a private database, but all payments remain simulated.</p></aside><main class="app-main">${feedback}${notice}${renderScreen()}</main></div>`;
  if (screen === 'requests' && $('#req-inst')) $('#req-inst').dispatchEvent(new Event('change', { bubbles: true }));
  feedback = '';
}
function renderLogin() {
  const demo = config.demo;
  app.innerHTML = `<header class="app-header"><a class="brand" href="/#"><img src="/assets/afremit-logo.png" width="52" height="52" alt=""><span>Afremit</span></a><div class="app-header-right"><span class="mode-badge">● TEST MODE</span><a href="/#">Back to site ↗</a></div></header><div class="app-main login-wrap"><div><p class="eyebrow"><span class="short-line"></span> Afremit pilot access</p><h1>A clearer way to <em>follow through.</em></h1><p class="app-intro">Choose a role to explore the local demo. With Supabase connected, invited participants use one Afremit email account for the same workflow.</p>${notice}</div><div class="login-card">${feedback}<h2>${demo ? 'Explore with a demo role' : 'Sign in to the pilot'}</h2>${demo ? `<form id="demo-login"><label for="demo-role">Choose a fictional account</label><select id="demo-role" name="role" required><option value="payer-demo">Payer · family abroad</option><option value="school-demo">School · finance team</option><option value="clinic-demo">Clinic · operations</option><option value="builder-demo">Construction · provider</option><option value="admin-demo">Afremit · reviewer</option></select><button class="button primary" type="submit">Open workspace <span>↗</span></button></form><p>Demo data is fictional and stored on this local computer.</p>` : !config.ready ? `<div class="empty">The connected pilot is not configured yet. The public preview is available; use the local demo for full workflow testing until a separate Afremit Supabase project is connected.</div>` : `<form id="auth-form"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="current-password" minlength="8" required><input name="intent" type="hidden" value="signin"><button class="button primary" type="submit">Sign in <span>↗</span></button><button class="link-button" data-action="toggle-auth" type="button">New to the pilot? Create an account</button></form><p>Registration may require email confirmation before sign-in. Afremit reviews provider applications separately.</p>`}</div></div>`;
  feedback = '';
}
function renderScreen() {
  switch (screen) { case 'applications': return applicationsScreen(); case 'requests': return requestsScreen(); case 'pay': return payScreen(); case 'transactions': return transactionsScreen(); case 'review': return reviewScreen(); default: return overviewScreen(); }
}
function heading(kicker, name, emphasis, description) { return `<p class="eyebrow"><span class="short-line"></span>${kicker}</p><h1>${name} <em>${emphasis}</em></h1><p class="app-intro">${description}</p>`; }
function overviewScreen() {
  const approved = data.applications.filter(a => a.status === 'pilot_approved');
  return `${heading('Your workspace','A journey with','clear steps.','Start with one provider application or a single test payment request. The workspace records each action and keeps the next step visible.')}
  <div class="app-grid"><div class="metric"><small>Provider applications</small><strong>${data.applications.length}</strong><span class="muted">${approved.length} approved for testing</span></div><div class="metric"><small>Your test requests</small><strong>${data.requests.length}</strong><span class="muted">Created by your provider team</span></div><div class="metric"><small>Visible transactions</small><strong>${data.payments.length}</strong><span class="muted">All simulated</span></div></div><div class="panel-stack"><section class="panel"><span class="panel-kicker">Start here</span><h2>Are you a provider?</h2><p>Apply with the basics. A school can create one fee request as soon as Afremit approves pilot access. Clinics and construction providers follow the same simple path.</p><button class="inline-button" data-screen="applications">Provider onboarding ↗</button></section><section class="panel"><span class="panel-kicker">A family member abroad</span><h2>Have a request code?</h2><p>Use a code shared by a participating provider to review its details and complete a test payment journey.</p><button class="inline-button" data-screen="pay">Review a request ↗</button></section></div>`;
}
function applicationsScreen() {
  return `${heading('For schools, clinics and builders','Start with','one request.','Tell the Afremit team how you currently issue and confirm requests. Pilot approval is a test-access decision, not verification for live payments.')}
  <div class="panel-stack"><section class="panel"><span class="panel-kicker">Your applications</span><h2>Provider status</h2>${data.applications.length ? data.applications.map(a => `<div class="list-row"><div><strong>${safe(a.name)}</strong><small>${title[a.sector]} · ${safe(a.country)} · ${date(a.created_at)}</small></div>${pill(a.status)}</div>`).join('') : '<div class="empty">No application yet. The form takes only a few minutes.</div>'}</section><section class="panel"><span class="panel-kicker">Apply for a guided test</span><h2>Tell us about your organization</h2><form id="apply-form" class="form-grid"><div class="field"><label for="app-name">Organization name</label><input id="app-name" name="name" maxlength="180" required></div><div class="field"><label for="app-sector">Service</label><select id="app-sector" name="sector"><option value="education">Education</option><option value="healthcare">Healthcare</option><option value="construction">Construction</option></select></div><div class="field"><label for="app-country">Country of service</label><input id="app-country" name="country" maxlength="80" required></div><div class="field"><label for="app-email">Authorized contact email</label><input id="app-email" name="contact_email" type="email" value="${safe(profile.email)}" required></div><div class="field full"><label for="app-note">How do you currently send and confirm requests? (optional)</label><textarea id="app-note" name="process_note" maxlength="800" placeholder="For example: our finance team emails a fee letter with a student reference."></textarea></div><div class="form-actions full"><button class="button primary" type="submit">Submit pilot application ↗</button></div></form></section></div>`;
}
function requestsScreen() {
  const options = data.applications.filter(a => a.status === 'pilot_approved');
  return `${heading('Provider workspace','Make just','one request.','A school fee, clinic estimate, or construction milestone is enough to begin. Your payer receives a private code rather than browsing a full catalogue.')}
  <div class="panel-stack"><section class="panel"><span class="panel-kicker">New test request</span><h2>Request details</h2>${options.length ? `<form id="request-form" class="form-grid"><div class="field full"><label for="req-inst">Provider</label><select id="req-inst" name="institution_id">${options.map(x => `<option value="${safe(x.id)}" data-sector="${safe(x.sector)}">${safe(x.name)} · ${title[x.sector]}</option>`).join('')}</select></div><p id="sector-hint" class="muted full">Education: enter one fee and the reference your finance team will use to identify it.</p><div class="field"><label for="req-title" id="request-title-label">Fee description</label><input id="req-title" name="title" placeholder="Autumn term tuition" maxlength="180" required></div><div class="field"><label for="req-ref" id="request-ref-label">Student reference</label><input id="req-ref" name="reference" placeholder="STU-1042" maxlength="100" required></div><div class="field"><label for="req-amount">Amount</label><input id="req-amount" name="amount" type="number" min="0.01" step="0.01" required></div><div class="field"><label for="req-currency">Provider currency</label><select id="req-currency" name="currency">${['GHS','NGN','KES','ZAR','XAF','XOF','GBP','EUR','USD','CAD'].map(x => `<option>${x}</option>`).join('')}</select></div><div class="field full"><label for="req-detail" id="request-detail-label">Fee period or programme (optional)</label><textarea id="req-detail" name="detail" maxlength="800" placeholder="What does this fee cover?"></textarea></div><div class="field full"><label for="req-condition">Condition for simulated release</label><textarea id="req-condition" name="release_condition" maxlength="500" placeholder="For example: finance team supplies a receipt or allocation reference for this fee; Afremit reviews it before test release." required></textarea><small>Describe evidence the provider would supply. Do not include personal or medical records.</small></div><div class="form-actions full"><button class="button primary" type="submit">Create test request ↗</button></div></form>` : '<div class="empty">Your provider application must be approved for pilot access before you can create a request. <button class="inline-button" data-screen="applications">Apply now ↗</button></div>'}</section><section class="panel"><span class="panel-kicker">Created by your team</span><h2>Share a private code</h2>${data.requests.length ? data.requests.map(r => `<div class="list-row"><div><strong>${safe(r.title)} · ${money(r.amount_minor,r.currency)}</strong><small>${safe(r.reference)} · ${date(r.created_at)}</small><small>Test link: <a class="code" href="/#app/pay?code=${encodeURIComponent(r.code)}">${safe(location.origin + '/#app/pay?code=' + r.code)}</a></small></div></div>`).join('') : '<div class="empty">Your first request will appear here with a private test link.</div>'}</section></div><section class="panel"><span class="panel-kicker">Optional assistance</span><h2>Draft from existing text</h2><p>Paste a short example fee letter, service estimate, or project note. The helper suggests an amount, currency, and reference from visible text. Review every field before creating a request. Nothing is sent to an AI service.</p><div class="field"><label for="draft-text">Example text</label><textarea id="draft-text" maxlength="3000" placeholder="Autumn term tuition: GHS 2,400. Reference STU-1042"></textarea></div><div class="action-row"><button class="inline-button" data-action="suggest">Suggest fields ↗</button></div><p id="draft-result" class="muted" aria-live="polite"></p></section>`;
}
function payScreen() {
  const code = new URLSearchParams((location.hash.split('?')[1] || '')).get('code') || '';
  return `${heading('For payers abroad','Understand it','before you act.','Use a private request code shared by a participating institution or provider. This journey records test states only; it does not collect card or bank details.')}
  <section class="panel"><span class="panel-kicker">Find a provider request</span><h2>Enter a private code</h2><form id="lookup-form" class="form-grid"><div class="field"><label for="lookup-code">Request code</label><input id="lookup-code" name="code" value="${safe(code)}" required></div><div class="form-actions"><button class="button primary" type="submit">Review details ↗</button></div></form><p class="muted">In the local demo, use <code class="code">SAMPLE-SCHOOL-2026</code> with the payer role.</p><div id="lookup-result"></div></section>`;
}
function transactionsScreen() {
  return `${heading('Test payment activity','Every step','accounted for.','View what the payer and provider can see. The held and allocated states are entries in a simulation ledger, not representations of real funds.')}
  <section class="panel"><span class="panel-kicker">Visible to your account</span><h2>Transactions</h2>${data.payments.length ? data.payments.map(p => `<div class="list-row"><div><strong>${safe(p.title)} · ${money(p.amount_minor,p.currency)}</strong><small>${safe(p.institution_name)} · ${safe(p.reference)} · ${date(p.created_at)}</small></div><div>${pill(p.status)} <button class="inline-button" data-action="details" data-id="${safe(p.id)}">View ↗</button></div></div>`).join('') : '<div class="empty">No test transactions yet. Follow a provider request to begin.</div>'}<div id="transaction-detail"></div></section>`;
}
function reviewScreen() {
  if (profile.role !== 'admin') return '<p>Not available.</p>';
  const m = data.metrics;
  const queue = data.payments.filter(p => p.status === 'disputed' || (p.status === 'test_held' && (p.evidence_status === 'submitted' || p.match_status === 'needs_review')));
  return `${heading('Afremit operations','The pilot','in view.','Review provider applications and observe real pilot interactions. Simulated payment amounts are never reported as revenue or transaction volume.')}
  <div class="app-grid"><div class="metric"><small>Provider applications</small><strong>${m.applications}</strong><span class="muted">${m.pending} awaiting review</span></div><div class="metric"><small>Test requests</small><strong>${m.requests}</strong><span class="muted">All provider sectors</span></div><div class="metric"><small>Simulated payments</small><strong>${m.test_payments}</strong><span class="muted">Real money volume: 0</span></div></div><section class="panel"><h2>Provider applications</h2>${data.applications.length ? data.applications.map(a => `<div class="list-row"><div><strong>${safe(a.name)}</strong><small>${title[a.sector]} · ${safe(a.country)} · ${safe(a.contact_email)}</small><small>${safe(a.process_note)}</small></div><div>${pill(a.status)}${a.status === 'pending' ? `<div class="action-row"><button class="inline-button" data-action="approve" data-id="${safe(a.id)}">Approve for pilot</button><button class="inline-button danger" data-action="decline" data-id="${safe(a.id)}">Decline</button></div>` : ''}</div></div>`).join('') : '<div class="empty">No applications yet.</div>'}</section><section class="panel"><h2>Exceptions needing review</h2>${queue.length ? queue.map(p => `<div class="list-row"><div><strong>${safe(p.title)}</strong><small>${safe(p.institution_name)}</small></div><button class="inline-button" data-action="details" data-id="${safe(p.id)}">Open transaction ↗</button></div>`).join('') : '<div class="empty">There are no test transactions waiting for review.</div>'}<div id="transaction-detail"></div></section>`;
}

app.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target, values = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'demo-login') { session = { demo: values.role }; localStorage.setItem('afremit-demo', values.role); await route(); return; }
    if (form.id === 'auth-form') {
      const signup = values.intent === 'signup';
      const response = await fetch(`${config.supabase_url}/auth/v1/${signup ? 'signup' : 'token?grant_type=password'}`, { method: 'POST', headers: { apikey: config.anon_key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: values.email, password: values.password }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.msg || result.error_description || result.message || 'Sign-in failed.');
      if (!result.access_token) { flash('Check your inbox to confirm your email, then sign in.'); return; }
      session = result; session.expires_at = Math.floor(Date.now() / 1000) + result.expires_in; localStorage.setItem('afremit-session', JSON.stringify(session)); await route(); return;
    }
    if (form.id === 'apply-form') { await api('applications', 'POST', values); await load(); flash('Application received. Afremit can now review it for pilot access.'); return; }
    if (form.id === 'request-form') {
      const decimals = ['XAF','XOF'].includes(values.currency) ? 0 : 2;
      const amount = Number(values.amount); if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 10 ** decimals) !== amount * 10 ** decimals) throw new Error('Enter a valid amount for this currency.');
      const item = await api('requests', 'POST', { ...values, amount_minor: Math.round(amount * 10 ** decimals) }); await load(); flash('Test request created. Share this private code with a payer: ' + item.code); return;
    }
    if (form.id === 'lookup-form') {
      const req = await api('requests/code/' + encodeURIComponent(values.code));
      $('#lookup-result').innerHTML = `<div class="panel"><span class="panel-kicker">${title[req.sector]} · simulated request</span><h2>${safe(req.title)}</h2><p><strong>${safe(req.institution_name)}</strong> · ${money(req.amount_minor, req.currency)}</p><p>Private reference: <span class="code">${safe(req.reference)}</span></p><p>${safe(req.detail)}</p><div class="notice"><strong>Simulated release condition:</strong> ${safe(req.release_condition || "Afremit reviews provider evidence before test release.")}<br>The provider submits evidence and an Afremit reviewer verifies it. No real funds are held.</div><p class="muted">The payer currency below identifies the origin. No foreign-exchange calculation or live quote is provided. You can change the reference or amount to test exception handling.</p><form id="payment-form" class="form-grid"><input type="hidden" name="code" value="${safe(req.code)}"><input type="hidden" name="currency" value="${safe(req.currency)}"><div class="field"><label for="payer-currency">Payer's currency</label><select id="payer-currency" name="payer_currency"><option>GBP</option><option>EUR</option><option>USD</option><option>CAD</option></select></div><div class="field"><label for="payer-reference">Reference entered on payment</label><input id="payer-reference" name="payer_reference" value="${safe(req.reference)}" maxlength="100" required></div><div class="field"><label for="payer-amount">Test amount in ${safe(req.currency)}</label><input id="payer-amount" name="amount" type="number" min="0.01" step="0.01" value="${safe(req.amount_minor / (['XAF','XOF'].includes(req.currency) ? 1 : 100))}" required></div><div class="field full"><label><input type="checkbox" name="accept_release_conditions" value="yes" required> I have reviewed the simulated release condition and understand this test does not move money.</label></div><div class="form-actions"><button class="button primary" type="submit">Create test payment ↗</button></div></form></div>`;
      return;
    }
    if (form.id === 'payment-form') { const decimals = ['XAF','XOF'].includes(values.currency) ? 0 : 2, amount = Number(values.amount); if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 10 ** decimals) !== amount * 10 ** decimals) throw new Error('Enter a valid test amount.'); const payment = await api('payments', 'POST', { code: values.code, payer_currency: values.payer_currency, payer_reference: values.payer_reference, amount_minor: Math.round(amount * 10 ** decimals), accept_release_conditions: values.accept_release_conditions === "yes", idempotency_key: id() }); await load(); setScreen('transactions'); flash('Test payment created. Open it to simulate the next step.'); return; }
  } catch (error) { flash(error.message, true); }
});

app.addEventListener('change', event => {
  if (event.target.id !== 'req-inst') return;
  const sector = event.target.selectedOptions[0]?.dataset.sector;
  const copy = {
    education: ['Education: enter one fee and the reference your finance team will use to identify it.','Fee description','Student reference','Fee period or programme (optional)','Autumn term tuition','STU-1042'],
    healthcare: ['Healthcare: describe an appointment or estimate only. Do not add diagnoses or patient records.','Service or estimate','Private case reference','Service scope (optional)','Consultation estimate','CARE-1042'],
    construction: ['Construction: describe one proposed milestone and how your team would confirm it.','Project milestone','Project reference','Completion criteria (optional)','Foundation milestone','BUILD-1042']
  }[sector];
  if (!copy) return;
  $('#sector-hint').textContent = copy[0]; $('#request-title-label').textContent = copy[1]; $('#request-ref-label').textContent = copy[2]; $('#request-detail-label').textContent = copy[3]; $('#req-title').placeholder = copy[4]; $('#req-ref').placeholder = copy[5];
});

app.addEventListener('click', async event => {
  const target = event.target.closest('[data-screen],[data-action]'); if (!target) return;
  if (target.dataset.screen) { setScreen(target.dataset.screen); return; }
  const action = target.dataset.action;
  try {
    if (action === 'signout') { signOut(); return; }
    if (action === 'toggle-auth') { const form = $('#auth-form'), signup = form.elements.intent.value === 'signin'; form.elements.intent.value = signup ? 'signup' : 'signin'; form.querySelector('.button').innerHTML = signup ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>'; target.textContent = signup ? 'Already registered? Sign in' : 'New to the pilot? Create an account'; return; }
    if (action === 'suggest') {
      const text = $('#draft-text').value;
      const match = text.match(/\b(GBP|EUR|USD|CAD|GHS|NGN|KES|ZAR|XAF|XOF)\s*([\d,]+(?:\.\d{1,2})?)/i);
      const reference = text.match(/(?:reference|ref|student\s+id)\s*[:#-]?\s*([\w/-]{3,35})/i);
      $('#draft-result').textContent = match ? `Suggested amount: ${match[1].toUpperCase()} ${match[2]}. ${reference ? `Suggested reference: ${reference[1]}. ` : ''}Check against the original document and enter the final details yourself.` : 'No obvious currency and amount found. Enter the request manually.'; return;
    }
    if (action === 'approve' || action === 'decline') { await api(`applications/${target.dataset.id}/review`, 'POST', { decision: action === 'approve' ? 'pilot_approved' : 'declined' }); await load(); flash('Application decision saved.'); return; }
    if (action === 'details') {
      const p = data.payments.find(x => x.id === target.dataset.id), view = $('#transaction-detail');
      const timeline = await api(`payments/${p.id}/timeline`);
      const isPayer = p.payer_id === profile.id, owns = data.applications.some(a => a.status === 'pilot_approved' && data.requests.some(r => r.id === p.request_id && r.institution_id === a.id));
      const held = timeline.ledger.filter(e => e.account === 'test_held').reduce((sum,e) => sum + (e.direction === 'credit' ? e.amount_minor : -e.amount_minor),0);
      const available = [
        p.status === 'created' && isPayer ? ['fund','Simulate payment'] : null,
        p.status === 'test_held' && owns ? ['submit_evidence','Submit provider evidence'] : null,
        p.status === 'test_held' && profile.role === 'admin' && p.match_status === 'needs_review' && p.amount_minor === data.requests.find(r => r.id === p.request_id)?.amount_minor ? ['resolve_match','Review reference mismatch'] : null,
        p.status === 'test_held' && profile.role === 'admin' && p.evidence_status === 'submitted' && p.match_status !== 'needs_review' ? ['verify_release','Verify release condition'] : null,
        p.status === 'test_held' && profile.role === 'admin' && p.evidence_status === 'verified' ? ['allocate','Simulate release to provider'] : null,
        p.status === 'test_held' ? ['dispute','Raise an exception'] : null,
        ['test_held','disputed'].includes(p.status) && profile.role === 'admin' && held >= p.amount_minor ? ['refund','Simulate refund'] : null
      ].filter(Boolean);
      view.innerHTML = `<div class="panel"><span class="panel-kicker">Audit detail · ${safe(p.id)}</span><h2>${safe(p.title)} ${pill(p.status)}</h2><p>${money(p.amount_minor,p.currency)} · ${safe(p.institution_name)}</p><p>Requested reference: <span class="code">${safe(p.reference)}</span> · payer entered: <span class="code">${safe(p.payer_reference || p.reference)}</span></p><p>Match review: ${pill(p.match_status || 'exact')} · Evidence: ${pill(p.evidence_status || 'awaiting')}</p><p><strong>Release condition:</strong> ${safe(p.release_condition)}</p>${p.evidence_note ? `<p><strong>Provider evidence:</strong> ${safe(p.evidence_note)}</p>` : ''}${p.verification_note ? `<p><strong>Reviewer decision:</strong> ${safe(p.verification_note)}</p>` : ''}${p.status === 'test_held' && p.match_status === 'needs_review' && p.amount_minor !== data.requests.find(r => r.id === p.request_id)?.amount_minor ? '<div class="notice">The amount differs from the request. Create a corrected request and a new test payment; this one cannot be released.</div>' : ''}<h3>Journey</h3>${timeline.events.map(e => `<div class="timeline-row"><b>${safe(e.action.replaceAll('_',' '))}</b><small>${date(e.created_at)}</small>${e.note ? `<p>${safe(e.note)}</p>` : ''}</div>`).join('')}${available.some(([key]) => key !== 'fund' && key !== 'allocate') ? '<div class="field"><label for="decision-note">Evidence or decision note</label><textarea id="decision-note" maxlength="800" placeholder="Describe the evidence, review reason, exception, or refund decision."></textarea></div>' : ''}<div class="action-row">${available.map(([key,label]) => `<button class="inline-button ${key === 'refund' ? 'danger' : ''}" data-action="payment-action" data-id="${safe(p.id)}" data-value="${key}">${label}</button>`).join('')}</div><h3 style="margin-top:30px">Simulation ledger</h3>${timeline.ledger.length ? `<table class="ledger-table"><thead><tr><th>Account</th><th>Entry</th><th>Amount</th></tr></thead><tbody>${timeline.ledger.map(e => `<tr><td>${safe(e.account)}</td><td>${safe(e.direction)}</td><td>${money(e.amount_minor,e.currency)}</td></tr>`).join('')}</tbody></table>` : '<p>No ledger movement yet.</p>'}<p class="muted">Ledger accounts are fictional. These entries do not represent a bank balance or funds under Afremit custody.</p></div>`;
      view.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    if (action === 'payment-action') { await api(`payments/${target.dataset.id}/actions`, 'POST', { action: target.dataset.value, note: $('#decision-note')?.value.trim() || '', idempotency_key: id() }); await load(); flash('Simulation updated. The new state is in the audit trail.'); return; }
  } catch (error) { flash(error.message, true); }
});
init();
