import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { AppError, requireText, optionalText, requireEmail, requireSector, requireCurrency, requireAmount, requireNote, canTransition, actionStatus, transitionEntries, balanced, heldBalance } from './domain.mjs';

const now = () => new Date().toISOString();
const code = () => randomBytes(10).toString('hex');
const seed = () => ({
  profiles: [
    { id: 'payer-demo', email: 'payer@afremit.test', role: 'payer', name: 'Alex Payer' },
    { id: 'school-demo', email: 'school@afremit.test', role: 'payer', name: 'School finance' },
    { id: 'clinic-demo', email: 'clinic@afremit.test', role: 'payer', name: 'Clinic operations' },
    { id: 'builder-demo', email: 'builder@afremit.test', role: 'payer', name: 'Project provider' },
    { id: 'admin-demo', email: 'admin@afremit.test', role: 'admin', name: 'Afremit team' }
  ],
  institutions: [
    { id: 'school-1', owner_id: 'school-demo', name: 'Example Learning Institute', sector: 'education', country: 'Ghana', contact_email: 'school@afremit.test', process_note: 'Use fee reference', status: 'pilot_approved', created_at: now() },
    { id: 'clinic-1', owner_id: 'clinic-demo', name: 'Example Care Centre', sector: 'healthcare', country: 'Ghana', contact_email: 'clinic@afremit.test', process_note: 'Appointment estimate', status: 'pilot_approved', created_at: now() },
    { id: 'builder-1', owner_id: 'builder-demo', name: 'Example Build Studio', sector: 'construction', country: 'Ghana', contact_email: 'builder@afremit.test', process_note: 'Milestone review', status: 'pilot_approved', created_at: now() }
  ],
  requests: [
    { id: 'request-1', institution_id: 'school-1', created_by: 'school-demo', code: 'SAMPLE-SCHOOL-2026', title: 'Autumn term tuition', reference: 'STU-1042', amount_minor: 240000, currency: 'GHS', detail: 'Fictional term-fee example', release_condition: 'Finance team supplies a receipt or account allocation reference for the stated term fee; Afremit reviewer checks the evidence before test release.', created_at: now() }
  ],
  payments: [], ledger_entries: [], events: []
});

export class MemoryStore {
  constructor(data = seed(), save = async () => {}) { this.data = data; this.save = save; }
  async commit() { await this.save(this.data); }
  profile(id) { const p = this.data.profiles.find(x => x.id === id); if (!p) throw new AppError('Sign in to continue.', 401); return p; }
  async listInstitutions() { return this.data.institutions.filter(x => x.status === 'pilot_approved').map(({ id, name, sector, country }) => ({ id, name, sector, country })); }
  async applications(user) { return this.data.institutions.filter(x => user.role === 'admin' || x.owner_id === user.id); }
  async apply(user, body) {
    const sector = requireSector(body.sector);
    if (this.data.institutions.some(x => x.owner_id === user.id && x.sector === sector && x.status !== 'declined')) throw new AppError('You already have an application for this service.');
    const item = { id: randomUUID(), owner_id: user.id, name: requireText(body.name, 'Organization name'), sector, country: requireText(body.country, 'Country', 80), contact_email: requireEmail(body.contact_email), process_note: optionalText(body.process_note), status: 'pending', created_at: now() };
    this.data.institutions.push(item); this.event(user, 'application', item.id, 'submitted'); await this.commit(); return item;
  }
  async review(user, id, decision) {
    if (user.role !== 'admin') throw new AppError('Only Afremit reviewers can make this decision.', 403);
    if (!['pilot_approved', 'declined'].includes(decision)) throw new AppError('Choose an application decision.');
    const item = this.data.institutions.find(x => x.id === id);
    if (!item) throw new AppError('Application not found.', 404);
    if (item.status !== 'pending') throw new AppError('This application was already reviewed.', 409);
    item.status = decision; this.event(user, 'application', id, decision); await this.commit(); return item;
  }
  async requests(user) {
    if (user.role === 'admin') return this.data.requests;
    const ids = new Set(this.data.institutions.filter(x => x.owner_id === user.id).map(x => x.id));
    return this.data.requests.filter(x => ids.has(x.institution_id));
  }
  async createRequest(user, body) {
    const institution = this.data.institutions.find(x => x.id === body.institution_id && x.owner_id === user.id && x.status === 'pilot_approved');
    if (!institution) throw new AppError('Pilot approval is needed before creating requests.', 403);
    const item = { id: randomUUID(), institution_id: institution.id, created_by: user.id, code: code(), title: requireText(body.title, 'Request title'), reference: requireText(body.reference, 'Private reference', 100), amount_minor: requireAmount(body.amount_minor), currency: requireCurrency(body.currency), detail: optionalText(body.detail), release_condition: requireText(body.release_condition, 'Test release condition', 500), created_at: now() };
    this.data.requests.push(item); this.event(user, 'request', item.id, 'created'); await this.commit(); return item;
  }
  async findRequest(codeValue) {
    const req = this.data.requests.find(x => x.code === codeValue);
    if (!req) throw new AppError('No test request matches this code.', 404);
    const institution = this.data.institutions.find(x => x.id === req.institution_id);
    if (institution?.status !== 'pilot_approved') throw new AppError('Provider pilot access is unavailable.', 403);
    return { ...req, institution_name: institution.name, sector: institution.sector };
  }
  async payments(user) {
    if (user.role === 'admin') return this.data.payments.map(p => this.enrich(p));
    const ids = new Set(this.data.institutions.filter(x => x.owner_id === user.id).map(x => x.id));
    return this.data.payments.filter(p => p.payer_id === user.id || ids.has(this.data.requests.find(r => r.id === p.request_id)?.institution_id)).map(p => this.enrich(p));
  }
  enrich(payment) { const req = this.data.requests.find(x => x.id === payment.request_id); const inst = this.data.institutions.find(x => x.id === req.institution_id); return { ...payment, title: req.title, reference: req.reference, release_condition: payment.release_condition || req.release_condition || 'Afremit reviewer checks provider evidence before test release.', institution_name: inst.name, sector: inst.sector }; }
  async createPayment(user, body) {
    const req = await this.findRequest(requireText(body.code, 'Request code', 100));
    if (user.id === req.created_by) throw new AppError('Use a separate payer account for this test.', 403);
    const idempotencyKey = requireText(body.idempotency_key, 'Submission key', 100);
    const existing = this.data.payments.find(x => x.payer_id === user.id && x.idempotency_key === idempotencyKey);
    if (existing) return this.enrich(existing);
    if (user.role === 'admin') throw new AppError('Use a payer account to test this journey.', 403);
    if (body.accept_release_conditions !== true) throw new AppError('Review and accept the test release conditions.');
    const amount = requireAmount(body.amount_minor ?? req.amount_minor), payerReference = requireText(body.payer_reference ?? req.reference, 'Payment reference', 100);
    const payment = { id: randomUUID(), request_id: req.id, payer_id: user.id, amount_minor: amount, currency: req.currency, payer_currency: requireCurrency(body.payer_currency), payer_reference: payerReference, match_status: amount === req.amount_minor && payerReference.trim().toLowerCase() === req.reference.trim().toLowerCase() ? 'exact' : 'needs_review', status: 'created', release_condition: req.release_condition || 'Afremit reviewer checks provider evidence before test release.', accepted_at: now(), evidence_status: 'awaiting', evidence_note: '', verification_note: '', verified_by: null, idempotency_key: idempotencyKey, created_at: now() };
    this.data.payments.push(payment); this.event(user, 'payment', payment.id, 'created'); await this.commit(); return this.enrich(payment);
  }
  async act(user, id, action, idempotencyKey, note = '') {
    requireText(idempotencyKey, 'Action key', 100);
    const payment = this.data.payments.find(x => x.id === id);
    if (!payment) throw new AppError('Payment not found.', 404);
    const req = this.data.requests.find(x => x.id === payment.request_id);
    const inst = this.data.institutions.find(x => x.id === req.institution_id);
    const role = user.role === 'admin' ? 'admin' : user.id === payment.payer_id ? 'payer' : inst.owner_id === user.id ? 'provider' : null;
    if (!role) throw new AppError('You cannot access this transaction.', 403);
    if (this.data.events.some(e => e.resource_id === id && e.key === idempotencyKey)) return this.enrich(payment);
    if (!canTransition(payment.status, action, role)) throw new AppError('This action is unavailable at the current stage.', 409);
    if (action === 'allocate' && (payment.evidence_status !== 'verified' || payment.match_status === 'needs_review')) throw new AppError('Afremit must verify the evidence and match before test release.', 409);
    if (action === 'submit_evidence') {
      payment.evidence_note = requireNote(note); payment.evidence_status = 'submitted'; payment.verified_by = null; payment.verification_note = '';
      this.event(user, 'payment', id, action, idempotencyKey, payment.evidence_note); await this.commit(); return this.enrich(payment);
    }
    if (action === 'verify_release') {
      if (!payment.accepted_at || payment.evidence_status !== 'submitted' || payment.match_status === 'needs_review' || payment.amount_minor !== req.amount_minor) throw new AppError('Payer agreement, evidence and exact amount must be reviewed before verification.', 409);
      payment.verification_note = requireNote(note, 'Review decision'); payment.evidence_status = 'verified'; payment.verified_by = user.id;
      this.event(user, 'payment', id, action, idempotencyKey, payment.verification_note); await this.commit(); return this.enrich(payment);
    }
    if (action === 'resolve_match') {
      if (payment.match_status !== 'needs_review') throw new AppError('There is no mismatch to resolve.', 409);
      if (payment.amount_minor !== req.amount_minor) throw new AppError('Amount mismatch requires a corrected request and a new test payment.', 409);
      payment.match_status = 'manually_confirmed'; this.event(user, 'payment', id, action, idempotencyKey, requireNote(note, 'Match review reason')); await this.commit(); return this.enrich(payment);
    }
    if (action === 'refund' && heldBalance(this.data.ledger_entries, id) < payment.amount_minor) throw new AppError('This test value was already allocated. A separate reversal workflow would be required.', 409);
    const decisionNote = ['refund','dispute'].includes(action) ? requireNote(note, 'Decision reason') : '';
    const entries = transitionEntries(payment, action, idempotencyKey);
    if (!balanced(entries)) throw new AppError('Ledger entries do not balance.', 500);
    payment.status = actionStatus[action]; this.data.ledger_entries.push(...entries.map(e => ({ ...e, id: randomUUID(), created_at: now() })));
    this.event(user, 'payment', id, action, idempotencyKey, decisionNote); await this.commit(); return this.enrich(payment);
  }
  event(user, resource, resource_id, action, key = '', note = '') { this.data.events.push({ id: randomUUID(), actor_id: user.id, resource, resource_id, action, key, note, created_at: now() }); }
  async timeline(user, paymentId) {
    const visible = (await this.payments(user)).some(x => x.id === paymentId);
    if (!visible) throw new AppError('Transaction not found.', 404);
    return { events: this.data.events.filter(x => x.resource === 'payment' && x.resource_id === paymentId), ledger: this.data.ledger_entries.filter(x => x.payment_id === paymentId) };
  }
  async metrics(user) {
    if (user.role !== 'admin') throw new AppError('Only Afremit reviewers can view pilot metrics.', 403);
    return { applications: this.data.institutions.length, pending: this.data.institutions.filter(x => x.status === 'pending').length, requests: this.data.requests.length, test_payments: this.data.payments.length, exceptions: this.data.payments.filter(x => x.status === 'disputed').length, real_volume_minor: 0 };
  }
}

export async function localStore(file = '.data/local.json') {
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch { data = seed(); }
  return new MemoryStore(data, async value => { await mkdir('.data', { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2)); });
}
