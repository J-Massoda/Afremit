import { AppError } from './domain.mjs';
import { SupabaseStore } from './supabase.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const identifier = value => { if (!/^[a-f0-9-]{36}$/i.test(value) && !/^(payer|school|clinic|builder|admin)-demo$/.test(value)) throw new AppError('Invalid identifier.'); return value; };
async function bodyOf(request) {
  if (Number(request.headers.get('content-length') || 0) > 16384) throw new AppError('Request is too large.', 413);
  const text = await request.text(); if (text.length > 16384) throw new AppError('Request is too large.', 413);
  try { return JSON.parse(text || '{}'); } catch { throw new AppError('Invalid JSON.'); }
}
async function identity(request, env, store, demo) {
  if (demo) {
    const id = request.headers.get('x-demo-user');
    if (!id || !['payer-demo', 'school-demo', 'clinic-demo', 'builder-demo', 'admin-demo'].includes(id)) throw new AppError('Select a demo account.', 401);
    return store.profile(id);
  }
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new AppError('Sign in to continue.', 401);
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new AppError('Your session has expired. Sign in again.', 401);
  const authUser = await response.json();
  return store.profile(authUser.id);
}

export async function handleApi(request, env = {}, options = {}) {
  try {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api\/?/, ''), method = request.method;
    const demo = options.demo === true;
    if (path === 'health' && method === 'GET') return json({ ok: true, mode: demo ? 'local-demo' : 'pilot-test', real_payments: false });
    if (path === 'config' && method === 'GET') return json({ demo, ready: demo || Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY), supabase_url: demo ? null : env.SUPABASE_URL || null, anon_key: demo ? null : env.SUPABASE_ANON_KEY || null, real_payments: false });
    const store = options.store || new SupabaseStore(env);
    const user = await identity(request, env, store, demo);
    if (path === 'me' && method === 'GET') return json(user);
    if (path === 'institutions' && method === 'GET') return json(await store.listInstitutions());
    if (path === 'applications' && method === 'GET') return json(await store.applications(user));
    if (path === 'applications' && method === 'POST') return json(await store.apply(user, await bodyOf(request)), 201);
    const review = path.match(/^applications\/([^/]+)\/review$/);
    if (review && method === 'POST') return json(await store.review(user, identifier(review[1]), (await bodyOf(request)).decision));
    if (path === 'requests' && method === 'GET') return json(await store.requests(user));
    if (path === 'requests' && method === 'POST') return json(await store.createRequest(user, await bodyOf(request)), 201);
    const lookup = path.match(/^requests\/code\/([^/]+)$/);
    if (lookup && method === 'GET') return json(await store.findRequest(decodeURIComponent(lookup[1])));
    if (path === 'payments' && method === 'GET') return json(await store.payments(user));
    if (path === 'payments' && method === 'POST') return json(await store.createPayment(user, await bodyOf(request)), 201);
    const action = path.match(/^payments\/([^/]+)\/actions$/);
    if (action && method === 'POST') {
      const body = await bodyOf(request);
      return json(await store.act(user, identifier(action[1]), body.action, body.idempotency_key, body.note));
    }
    const timeline = path.match(/^payments\/([^/]+)\/timeline$/);
    if (timeline && method === 'GET') return json(await store.timeline(user, identifier(timeline[1])));
    if (path === 'admin/metrics' && method === 'GET') return json(await store.metrics(user));
    return json({ error: 'Route not found.' }, 404);
  } catch (error) {
    if (!(error instanceof AppError)) console.error('API error', error);
    return json({ error: error instanceof AppError ? error.message : 'An unexpected error occurred.' }, error instanceof AppError ? error.status : 500);
  }
}
