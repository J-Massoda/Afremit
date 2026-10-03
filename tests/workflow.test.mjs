import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/memory.mjs';
import { heldBalance } from '../src/domain.mjs';
import { handleApi } from '../src/api.mjs';
import { SupabaseStore } from '../src/supabase.mjs';

const store = () => new MemoryStore(undefined, async () => {});
const user = (s, id) => s.profile(id + '-demo');

test('education payment moves through created, held, allocated with balanced ledger and audit trail', async () => {
  const s = store(); const payer = user(s, 'payer'), school = user(s, 'school');
  const payment = await s.createPayment(payer, { code: 'SAMPLE-SCHOOL-2026', payer_currency: 'GBP', idempotency_key: 'payer-click-1' });
  assert.equal(payment.status, 'created');
  assert.equal((await s.createPayment(payer, { code: 'SAMPLE-SCHOOL-2026', payer_currency: 'GBP', idempotency_key: 'payer-click-1' })).id, payment.id);
  assert.equal((await s.act(payer, payment.id, 'fund', 'fund-click-1')).status, 'test_held');
  assert.equal((await s.act(school, payment.id, 'allocate', 'school-click-1')).status, 'allocated');
  assert.equal(heldBalance(s.data.ledger_entries, payment.id), 0);
  assert.equal(s.data.ledger_entries.length, 4);
  assert.equal((await s.timeline(payer, payment.id)).events.length, 3);
  assert.equal((await s.act(school, payment.id, 'allocate', 'school-click-1')).status, 'allocated');
  assert.equal(s.data.ledger_entries.length, 4);
});

test('provider applications have a review gate across all three service types', async () => {
  const s = store(); const admin = user(s, 'admin'), payer = user(s, 'payer');
  const application = await s.apply(payer, { name: 'Fictional Academy', sector: 'education', country: 'Ghana', contact_email: 'finance@example.org' });
  assert.equal(application.status, 'pending');
  await assert.rejects(s.createRequest(payer, { institution_id: application.id, title: 'Term fee', reference: 'REF-1', amount_minor: 1000, currency: 'GHS' }), /Pilot approval/);
  await assert.rejects(s.review(payer, application.id, 'pilot_approved'), /Only Afremit/);
  await s.review(admin, application.id, 'pilot_approved');
  const request = await s.createRequest(payer, { institution_id: application.id, title: 'Term fee', reference: 'REF-1', amount_minor: 1000, currency: 'GHS' });
  assert.ok(request.code.length >= 16);
  for (const sector of ['healthcare', 'construction']) {
    const another = await s.apply(payer, { name: `Example ${sector}`, sector, country: 'Ghana', contact_email: 'finance@example.org' });
    assert.equal(another.sector, sector);
  }
  assert.equal((await s.listInstitutions()).some(x => x.id === application.id), true);
});

test('authorization prevents another payer from seeing or changing a payment', async () => {
  const s = store(); s.data.profiles.push({ id: 'stranger-demo', email: 'stranger@example.org', role: 'payer' });
  const p = await s.createPayment(user(s, 'payer'), { code: 'SAMPLE-SCHOOL-2026', payer_currency: 'EUR', idempotency_key: 'pay-2' });
  assert.equal((await s.payments(s.profile('stranger-demo'))).length, 0);
  await assert.rejects(s.timeline(s.profile('stranger-demo'), p.id), /not found/);
  await assert.rejects(s.act(s.profile('stranger-demo'), p.id, 'fund', 'bad-action'), /cannot access/);
  await assert.rejects(s.act(user(s,'school'), p.id, 'fund', 'wrong-role'), /unavailable/);
});

test('disputed held value can be refunded once, allocated value cannot be refunded from empty hold', async () => {
  const s = store(); const payer = user(s,'payer'), admin = user(s,'admin'), school = user(s,'school');
  const p = await s.createPayment(payer, { code:'SAMPLE-SCHOOL-2026',payer_currency:'USD',idempotency_key:'pay-3' });
  await s.act(payer,p.id,'fund','fund-3'); await s.act(payer,p.id,'dispute','dispute-3');
  assert.equal((await s.act(admin,p.id,'refund','refund-3')).status,'refunded');
  assert.equal(heldBalance(s.data.ledger_entries,p.id),0);
  await assert.rejects(s.act(admin,p.id,'refund','refund-again'), /unavailable/);
  const next = await s.createPayment(payer,{code:'SAMPLE-SCHOOL-2026',payer_currency:'GBP',idempotency_key:'pay-4'});
  await s.act(payer,next.id,'fund','fund-4'); await s.act(school,next.id,'allocate','allocate-4'); await s.act(payer,next.id,'dispute','dispute-4');
  await assert.rejects(s.act(admin,next.id,'refund','refund-4'), /already allocated/);
});

test('short amount and incorrect reference require manual match review before allocation', async () => {
  const s = store(), payer = user(s,'payer'), school = user(s,'school');
  const p = await s.createPayment(payer,{code:'SAMPLE-SCHOOL-2026',payer_currency:'GBP',payer_reference:'WRONG-REF',amount_minor:200000,idempotency_key:'mismatch-1'});
  assert.equal(p.match_status,'needs_review');
  await s.act(payer,p.id,'fund','mismatch-fund');
  await assert.rejects(s.act(school,p.id,'allocate','mismatch-allocate'),/Resolve/);
  assert.equal((await s.act(school,p.id,'resolve_match','mismatch-review')).match_status,'manually_confirmed');
  assert.equal((await s.act(school,p.id,'allocate','mismatch-allocate-after-review')).status,'allocated');
  assert.equal(s.data.ledger_entries.every(e => e.amount_minor === 200000),true);
});

test('HTTP API rejects missing account and enforces reviewer permissions', async () => {
  const s = store();
  const req = (path, role, method = 'GET', body) => new Request(`http://localhost/api/${path}`, { method, headers: { 'X-Demo-User': role, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await handleApi(req('me',''), {}, {demo:true,store:s})).status,401);
  assert.equal((await handleApi(req('admin/metrics','payer-demo'), {}, {demo:true,store:s})).status,403);
  assert.equal((await handleApi(req('admin/metrics','admin-demo'), {}, {demo:true,store:s})).status,200);
  const response = await handleApi(req('payments','payer-demo','POST',{code:'SAMPLE-SCHOOL-2026',payer_currency:'GBP',idempotency_key:'http-1'}),{}, {demo:true,store:s});
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
