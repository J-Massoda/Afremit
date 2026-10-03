export const sectors = ['education', 'healthcare', 'construction'];
export const currencies = ['GBP', 'EUR', 'USD', 'CAD', 'ZAR', 'NGN', 'GHS', 'KES', 'XAF', 'XOF'];
export const applicationStatuses = ['pending', 'pilot_approved', 'declined'];
export const paymentStatuses = ['created', 'test_held', 'allocated', 'disputed', 'refunded'];

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const requireText = (value, name, max = 180) => {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new AppError(`${name} is required (maximum ${max} characters).`);
  return result;
};
export const optionalText = (value, max = 800) => String(value ?? '').trim().slice(0, max);
export const requireEmail = (value) => {
  const email = requireText(value, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Enter a valid email address.');
  return email;
};
export const requireAmount = (value) => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000000) throw new AppError('Enter an amount in minor currency units.');
  return amount;
};
export const requireSector = value => {
  if (!sectors.includes(value)) throw new AppError('Choose education, healthcare, or construction.');
  return value;
};
export const requireCurrency = value => {
  if (!currencies.includes(value)) throw new AppError('Choose a supported display currency.');
  return value;
};
export const requireNote = (value, name = 'Evidence note') => requireText(value, name, 800);
export const canTransition = (from, action, role) => ({
  fund: from === 'created' && role === 'payer',
  submit_evidence: from === 'test_held' && role === 'provider',
  verify_release: from === 'test_held' && role === 'admin',
  allocate: from === 'test_held' && role === 'admin',
  resolve_match: from === 'test_held' && role === 'admin',
  dispute: from === 'test_held' && ['payer', 'provider', 'admin'].includes(role),
  refund: ['test_held', 'disputed'].includes(from) && role === 'admin'
})[action] === true;

export function transitionEntries(payment, action, eventKey) {
  const amount = requireAmount(payment.amount_minor);
  const base = { payment_id: payment.id, event_key: eventKey, amount_minor: amount, currency: payment.currency };
  if (action === 'fund') return [
    { ...base, account: 'test_payer', direction: 'debit' },
    { ...base, account: 'test_held', direction: 'credit' }
  ];
  if (action === 'allocate') return [
    { ...base, account: 'test_held', direction: 'debit' },
    { ...base, account: 'test_provider', direction: 'credit' }
  ];
  if (action === 'refund') return [
    { ...base, account: 'test_held', direction: 'debit' },
    { ...base, account: 'test_payer', direction: 'credit' }
  ];
  return [];
}

export const actionStatus = { fund: 'test_held', allocate: 'allocated', dispute: 'disputed', refund: 'refunded' };
export function balanced(entries) {
  const debit = entries.filter(x => x.direction === 'debit').reduce((a, x) => a + x.amount_minor, 0);
  const credit = entries.filter(x => x.direction === 'credit').reduce((a, x) => a + x.amount_minor, 0);
  return debit === credit;
}
export function heldBalance(entries, paymentId) {
  return entries.filter(x => x.payment_id === paymentId && x.account === 'test_held').reduce((total, x) => total + (x.direction === 'credit' ? x.amount_minor : -x.amount_minor), 0);
}
