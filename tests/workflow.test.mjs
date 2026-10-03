import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/memory.mjs';
import { heldBalance } from '../src/domain.mjs';
import { handleApi } from '../src/api.mjs';
import { SupabaseStore } from '../src/supabase.mjs';

const store = () => new MemoryStore(undefined, async () => {});
const user = (s, id) => s.profile(id + '-demo');
const paymentBody = (key, extra = {}) => ({ code: 'SAMPLE-SCHOOL-2026', payer_currency: 'GBP', accept_release_conditions: true, idempotency_key: key, ...extra });

test('payer consent, provider evidence and independent reviewer gate test release', async () => {
  const s = store(); const payer = user(s, 'payer'), school = user(s, 'school'), admin = user(s, 'admin');
  await assert.rejects(s.createPayment(payer, { ...paymentBody('without-consent'), accept_release_conditions: false }), /accept/);
  const payment = await s.createPayment(payer, paymentBody('payer-click-1'));
  assert.equal(payment.status, 'created');
  assert.ok(payment.release_condition && payment.accepted_at);
  assert.equal((await s.createPayment(payer, paymentBody('payer-click-1'))).id, payment.id);
  await s.act(payer, payment.id, 'fund', 'fund-click-1');
  await assert.rejects(s.act(school, payment.id, 'allocate', 'provider-release'), /unavailable/);
  await assert.rejects(s.act(admin, payment.id, 'allocate', 'premature-release'), /verify/);
  await s.act(school, payment.id, 'submit_evidence', 'evidence-1', 'Receipt reference and allocation supplied');
  await assert.rejects(s.act(school, payment.id, 'verify_release', 'self-verify', 'Confirmed'), /unavailable/);
  await s.act(admin, payment.id, 'verify_release', 'verify-1', 'Checked receipt against request');
  assert.equal((await s.act(admin, payment.id, 'allocate', 'release-1')).status, 'allocated');
  assert.equal(heldBalance(s.data.ledger_entries, payment.id), 0);
  assert.equal(s.data.ledger_entries.length, 4);
  assert.equal((await s.timeline(payer, payment.id)).events.length, 5);
  assert.equal((await s.act(admin, payment.id, 'allocate', 'release-1')).status, 'allocated');
  assert.equal(s.data.ledger_entries.length, 4);
});

test('provider applications have a review gate across all three service types', async () => {
  const s = store(); const admin = user(s, 'admin'), payer = user(s, 'payer');
  const application = await s.apply(payer, { name: 'Fictional Academy', sector: 'education', country: 'Ghana', contact_email: 'finance@example.org' });
  assert.equal(application.status, 'pending');
  await assert.rejects(s.createRequest(payer, { institution_id: application.id, title: 'Term fee', reference: 'REF-1', amount_minor: 1000, currency: 'GHS', release_condition: 'Reviewer confirms receipt' }), /Pilot approval/);
  await assert.rejects(s.review(payer, application.id, 'pilot_approved'), /Only Afremit/);
  await s.review(admin, application.id, 'pilot_approved');
  const request = await s.createRequest(payer, { institution_id: application.id, title: 'Term fee', reference: 'REF-1', amount_minor: 1000, currency: 'GHS', release_condition: 'Reviewer confirms receipt' });
  assert.ok(request.code.length >= 16);
  for (const sector of ['healthcare', 'construction']) {
    const another = await s.apply(payer, { name: `Example ${sector}`, sector, country: 'Ghana', contact_email: 'finance@example.org' });
    assert.equal(another.sector, sector);
  }
  assert.equal((await s.listInstitutions()).some(x => x.id === application.id), true);
});

test('authorization prevents another payer from seeing or changing a payment', async () => {
  const s = store(); s.data.profiles.push({ id: 'stranger-demo', email: 'stranger@example.org', role: 'payer' });
  const p = await s.createPayment(user(s, 'payer'), paymentBody('pay-2', { payer_currency: 'EUR' }));
  assert.equal((await s.payments(s.profile('stranger-demo'))).length, 0);
  await assert.rejects(s.timeline(s.profile('stranger-demo'), p.id), /not found/);
  await assert.rejects(s.act(s.profile('stranger-demo'), p.id, 'fund', 'bad-action'), /cannot access/);
  await s.act(user(s, 'payer'), p.id, 'fund', 'fund-by-payer');
  await assert.rejects(s.act(s.profile('stranger-demo'), p.id, 'fund', 'fund-by-payer'), /cannot access/);
  await assert.rejects(s.act(user(s,'school'), p.id, 'fund', 'wrong-role'), /unavailable/);
});

test('disputed held test value can be refunded with an audited reason', async () => {
  const s = store(); const payer = user(s,'payer'), admin = user(s,'admin');
  const p = await s.createPayment(payer, paymentBody('pay-3'));
  await s.act(payer,p.id,'fund','fund-3');
  await assert.rejects(s.act(payer,p.id,'dispute','no-reason'), /required/);
  await s.act(payer,p.id,'dispute','dispute-3','Allocation has not been confirmed');
  assert.equal((await s.act(admin,p.id,'refund','refund-3','Approve test refund')).status,'refunded');
  assert.equal(heldBalance(s.data.ledger_entries,p.id),0);
  assert.equal((await s.timeline(payer,p.id)).events.at(-1).note,'Approve test refund');
  await assert.rejects(s.act(admin,p.id,'refund','refund-again','Again'), /unavailable/);
});

test('incorrect reference requires reviewer match decision; short amount cannot be released', async () => {
  const s = store(), payer = user(s,'payer'), school = user(s,'school'), admin = user(s,'admin');
  const short = await s.createPayment(payer,paymentBody('short-1',{payer_reference:'WRONG-REF',amount_minor:200000}));
  await s.act(payer,short.id,'fund','short-fund');
  await s.act(school,short.id,'submit_evidence','short-evidence','Fictional receipt');
  await assert.rejects(s.act(admin,short.id,'resolve_match','short-match','Checked'),/corrected request/);
  await assert.rejects(s.act(admin,short.id,'verify_release','short-verify','Checked'),/exact amount/);
  const reference = await s.createPayment(payer,paymentBody('reference-1',{payer_reference:'WRONG-REF'}));
  await s.act(payer,reference.id,'fund','reference-fund');
  await s.act(school,reference.id,'submit_evidence','reference-evidence','Receipt reference supplied');
  await s.act(admin,reference.id,'resolve_match','reference-match','Confirmed reference with provider');
  await s.act(admin,reference.id,'verify_release','reference-verify','Evidence reviewed');
  assert.equal((await s.act(admin,reference.id,'allocate','reference-release')).status,'allocated');
  assert.equal(s.data.ledger_entries.filter(e => e.payment_id === reference.id).every(e => e.amount_minor === 240000),true);
});

test('HTTP API rejects missing account and enforces reviewer permissions', async () => {
  const s = store();
  const req = (path, role, method = 'GET', body) => new Request(`http://localhost/api/${path}`, { method, headers: { 'X-Demo-User': role, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await handleApi(req('me',''), {}, {demo:true,store:s})).status,401);
  assert.equal((await handleApi(req('admin/metrics','payer-demo'), {}, {demo:true,store:s})).status,403);
  assert.equal((await handleApi(req('admin/metrics','admin-demo'), {}, {demo:true,store:s})).status,200);
  const response = await handleApi(req('payments','payer-demo','POST',{code:'SAMPLE-SCHOOL-2026',payer_currency:'GBP',accept_release_conditions:true,idempotency_key:'http-1'}),{}, {demo:true,store:s});
  assert.equal(response.status,201);
  assert.equal((await response.json()).status,'created');
});

test('new Supabase secret API keys are never sent as Bearer JWTs', async () => {
  const original = globalThis.fetch; let headers;
  globalThis.fetch = async (_url, options) => { headers = options.headers; return new Response('[]', { headers: { 'Content-Type': 'application/json' } }); };
  try { await new SupabaseStore({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' }).query('profiles', 'select=id'); }
  finally { globalThis.fetch = original; }
  assert.equal(headers.apikey, 'sb_secret_test'); assert.equal(headers.Authorization, undefined);
});
