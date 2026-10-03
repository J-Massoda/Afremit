import { AppError, requireText, optionalText, requireEmail, requireSector, requireCurrency, requireAmount } from './domain.mjs';

export class SupabaseStore {
  constructor(env) { this.url = env.SUPABASE_URL?.replace(/\/$/, ''); this.key = env.SUPABASE_SERVICE_ROLE_KEY; if (!this.url || !this.key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); }
  async request(path, method = 'GET', body, prefer = '') {
    const authHeader = this.key.startsWith('sb_') ? {} : { Authorization: `Bearer ${this.key}` };
    const response = await fetch(`${this.url}/rest/v1/${path}`, { method, headers: { apikey: this.key, ...authHeader, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 409 || value?.code === '23505') throw new AppError('This action has already been completed.', 409);
      throw new AppError('The pilot database could not complete this action.', response.status >= 500 ? 503 : 400);
    }
    return value;
  }
  query(table, params = '') { return this.request(`${table}?${params}`); }
  async profile(id) { const rows = await this.query('profiles', `id=eq.${encodeURIComponent(id)}&select=id,email,role,name`); if (!rows[0]) throw new AppError('Complete account registration first.', 401); return rows[0]; }
  async listInstitutions() { return this.query('institutions', 'status=eq.pilot_approved&select=id,name,sector,country&order=name.asc'); }
  async applications(user) { return this.query('institutions', `${user.role === 'admin' ? '' : `owner_id=eq.${user.id}&`}select=*&order=created_at.desc`); }
  async apply(user, body) {
    const sector = requireSector(body.sector);
    const existing = await this.query('institutions', `owner_id=eq.${user.id}&sector=eq.${sector}&status=neq.declined&select=id`);
    if (existing.length) throw new AppError('You already have an application for this service.');
    const item = { owner_id: user.id, name: requireText(body.name, 'Organization name'), sector, country: requireText(body.country, 'Country', 80), contact_email: requireEmail(body.contact_email), process_note: optionalText(body.process_note) };
    return (await this.request('institutions', 'POST', item, 'return=representation'))[0];
  }
  async review(user, id, decision) {
    if (user.role !== 'admin') throw new AppError('Only Afremit reviewers can make this decision.', 403);
    if (!['pilot_approved', 'declined'].includes(decision)) throw new AppError('Choose an application decision.');
    const rows = await this.request(`institutions?id=eq.${encodeURIComponent(id)}&status=eq.pending`, 'PATCH', { status: decision, reviewed_by: user.id }, 'return=representation');
    if (!rows.length) throw new AppError('Application not found or already reviewed.', 409);
    return rows[0];
  }
  async requests(user) {
    if (user.role === 'admin') return this.query('fee_requests', 'select=*&order=created_at.desc');
    const owned = await this.query('institutions', `owner_id=eq.${user.id}&select=id`);
    if (!owned.length) return [];
    return this.query('fee_requests', `institution_id=in.(${owned.map(x => x.id).join(',')})&select=*&order=created_at.desc`);
  }
  async createRequest(user, body) {
    const owned = await this.query('institutions', `id=eq.${encodeURIComponent(body.institution_id)}&owner_id=eq.${user.id}&status=eq.pilot_approved&select=id`);
    if (!owned.length) throw new AppError('Pilot approval is needed before creating requests.', 403);
    const value = { institution_id: owned[0].id, created_by: user.id, title: requireText(body.title, 'Request title'), reference: requireText(body.reference, 'Private reference', 100), amount_minor: requireAmount(body.amount_minor), currency: requireCurrency(body.currency), detail: optionalText(body.detail) };
    return (await this.request('fee_requests', 'POST', value, 'return=representation'))[0];
  }
  async findRequest(code) {
    const rows = await this.query('fee_requests', `code=eq.${encodeURIComponent(code)}&select=*`);
    const req = rows[0]; if (!req) throw new AppError('No test request matches this code.', 404);
    const inst = (await this.query('institutions', `id=eq.${req.institution_id}&status=eq.pilot_approved&select=name,sector`))[0];
    if (!inst) throw new AppError('Provider pilot access is unavailable.', 403);
    return { ...req, institution_name: inst.name, sector: inst.sector };
  }
  async enrich(payment) {
    const req = (await this.query('fee_requests', `id=eq.${payment.request_id}&select=title,reference,institution_id`))[0];
    const inst = (await this.query('institutions', `id=eq.${req.institution_id}&select=name,sector`))[0];
    return { ...payment, title: req.title, reference: req.reference, institution_name: inst.name, sector: inst.sector };
  }
  async payments(user) {
    let filter = '';
    if (user.role !== 'admin') {
      const owned = await this.query('institutions', `owner_id=eq.${user.id}&select=id`);
      const requests = owned.length ? await this.query('fee_requests', `institution_id=in.(${owned.map(x => x.id).join(',')})&select=id`) : [];
      filter = requests.length ? `or=(payer_id.eq.${user.id},request_id.in.(${requests.map(x => x.id).join(',')}))&` : `payer_id=eq.${user.id}&`;
    }
    const payments = await this.query('pilot_payments', `${filter}select=*&order=created_at.desc`);
    return Promise.all(payments.map(x => this.enrich(x)));
  }
  async createPayment(user, body) {
    const key = requireText(body.idempotency_key, 'Submission key', 100);
    const code = requireText(body.code, 'Request code', 100);
    const payerCurrency = requireCurrency(body.payer_currency);
    const req = await this.findRequest(code);
    const value = await this.request('rpc/pilot_create_payment', 'POST', { p_actor: user.id, p_code: code, p_currency: payerCurrency, p_key: key, p_amount: requireAmount(body.amount_minor ?? req.amount_minor), p_reference: requireText(body.payer_reference ?? req.reference, 'Payment reference', 100) });
    return this.enrich(value);
  }
  async act(user, id, action, key) {
    const value = await this.request('rpc/pilot_payment_action', 'POST', { p_actor: user.id, p_payment: id, p_action: action, p_key: requireText(key, 'Action key', 100) });
    return this.enrich(value);
  }
  async timeline(user, paymentId) {
    if (!(await this.payments(user)).some(x => x.id === paymentId)) throw new AppError('Transaction not found.', 404);
    const [events, ledger] = await Promise.all([
      this.query('audit_events', `resource=eq.payment&resource_id=eq.${paymentId}&select=action,actor_id,created_at&order=created_at.asc`),
      this.query('ledger_entries', `payment_id=eq.${paymentId}&select=account,direction,amount_minor,currency,created_at&order=created_at.asc`)
    ]);
    return { events, ledger };
  }
  async metrics(user) {
    if (user.role !== 'admin') throw new AppError('Only Afremit reviewers can view pilot metrics.', 403);
    const [apps, reqs, payments] = await Promise.all([this.query('institutions', 'select=id,status'), this.query('fee_requests', 'select=id'), this.query('pilot_payments', 'select=id,status')]);
    return { applications: apps.length, pending: apps.filter(x => x.status === 'pending').length, requests: reqs.length, test_payments: payments.length, exceptions: payments.filter(x => x.status === 'disputed').length, real_volume_minor: 0 };
  }
}
