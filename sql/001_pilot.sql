-- Afremit PILOT ONLY. This database never stores real balances or initiates external payments.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'payer' check (role in ('payer','admin')),
  created_at timestamptz not null default now()
);

create or replace function public.afremit_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,email,name) values (new.id, coalesce(new.email,''), coalesce(new.raw_user_meta_data->>'name',''));
  return new;
end $$;
drop trigger if exists afremit_new_user on auth.users;
create trigger afremit_new_user after insert on auth.users for each row execute function public.afremit_new_user();

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 180),
  sector text not null check (sector in ('education','healthcare','construction')),
  country text not null,
  contact_email text not null,
  process_note text not null default '',
  status text not null default 'pending' check (status in ('pending','pilot_approved','declined')),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists institutions_active_owner_sector on public.institutions(owner_id,sector) where status <> 'declined';

create table if not exists public.fee_requests (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id),
  created_by uuid not null references public.profiles(id),
  code text not null unique default encode(gen_random_bytes(12),'hex'),
  title text not null,
  reference text not null,
  amount_minor bigint not null check (amount_minor between 1 and 100000000000),
  currency text not null check (currency in ('GBP','EUR','USD','CAD','ZAR','NGN','GHS','KES','XAF','XOF')),
  detail text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.pilot_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.fee_requests(id),
  payer_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor between 1 and 100000000000),
  currency text not null,
  payer_currency text not null,
  payer_reference text not null,
  match_status text not null check (match_status in ('exact','needs_review','manually_confirmed')),
  status text not null default 'created' check (status in ('created','test_held','allocated','disputed','refunded')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(payer_id,idempotency_key)
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.pilot_payments(id),
  event_key text not null,
  account text not null check (account in ('test_payer','test_held','test_provider')),
  direction text not null check (direction in ('debit','credit')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  created_at timestamptz not null default now(),
  unique(payment_id,event_key,account,direction)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  resource text not null,
  resource_id uuid not null,
  action text not null,
  key text not null default '',
  created_at timestamptz not null default now(),
  unique(resource,resource_id,key)
);

create or replace function public.afremit_audit_record() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'institutions' then
    insert into public.audit_events(actor_id,resource,resource_id,action,key)
      values (coalesce(new.reviewed_by,new.owner_id),'application',new.id,case when tg_op = 'INSERT' then 'submitted' else new.status end, gen_random_uuid()::text);
  elsif tg_table_name = 'fee_requests' then
    insert into public.audit_events(actor_id,resource,resource_id,action,key)
      values (new.created_by,'request',new.id,'created',gen_random_uuid()::text);
  end if;
  return new;
end $$;
drop trigger if exists afremit_audit_app on public.institutions;
create trigger afremit_audit_app after insert or update of status on public.institutions for each row execute function public.afremit_audit_record();
drop trigger if exists afremit_audit_request on public.fee_requests;
create trigger afremit_audit_request after insert on public.fee_requests for each row execute function public.afremit_audit_record();

create or replace function public.pilot_create_payment(p_actor uuid,p_code text,p_currency text,p_key text,p_amount bigint,p_reference text)
returns public.pilot_payments language plpgsql security definer set search_path = public as $$
declare v_req public.fee_requests; v_payment public.pilot_payments;
begin
  if p_key is null or char_length(p_key) not between 1 and 100 then raise exception 'Invalid submission key'; end if;
  if p_currency not in ('GBP','EUR','USD','CAD','ZAR','NGN','GHS','KES','XAF','XOF') then raise exception 'Invalid currency'; end if;
  if p_amount not between 1 and 100000000000 or p_reference is null or char_length(trim(p_reference)) not between 1 and 100 then raise exception 'Invalid payment details'; end if;
  if exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Use a payer account'; end if;
  select * into v_payment from public.pilot_payments where payer_id=p_actor and idempotency_key=p_key;
  if found then return v_payment; end if;
  select r.* into v_req from public.fee_requests r join public.institutions i on i.id=r.institution_id
    where r.code=p_code and i.status='pilot_approved';
  if not found then raise exception 'Request unavailable'; end if;
  if v_req.created_by=p_actor then raise exception 'Provider cannot pay own request'; end if;
  insert into public.pilot_payments(request_id,payer_id,amount_minor,currency,payer_currency,payer_reference,match_status,idempotency_key)
    values(v_req.id,p_actor,p_amount,v_req.currency,p_currency,trim(p_reference),
      case when p_amount=v_req.amount_minor and lower(trim(p_reference))=lower(trim(v_req.reference)) then 'exact' else 'needs_review' end,p_key) returning * into v_payment;
  insert into public.audit_events(actor_id,resource,resource_id,action,key) values(p_actor,'payment',v_payment.id,'created',p_key);
  return v_payment;
end $$;

create or replace function public.pilot_payment_action(p_actor uuid,p_payment uuid,p_action text,p_key text)
returns public.pilot_payments language plpgsql security definer set search_path = public as $$
declare v_payment public.pilot_payments; v_owner uuid; v_role text; v_next text; v_from text; v_to text;
begin
  if p_key is null or char_length(p_key) not between 1 and 100 then raise exception 'Invalid action key'; end if;
  select * into v_payment from public.pilot_payments where id=p_payment for update;
  if not found then raise exception 'Payment unavailable'; end if;
  if exists(select 1 from public.audit_events where resource='payment' and resource_id=p_payment and key=p_key) then return v_payment; end if;
  select i.owner_id into v_owner from public.fee_requests r join public.institutions i on i.id=r.institution_id where r.id=v_payment.request_id;
  if exists(select 1 from public.profiles where id=p_actor and role='admin') then v_role := 'admin';
  elsif p_actor=v_payment.payer_id then v_role := 'payer';
  elsif p_actor=v_owner then v_role := 'provider';
  else raise exception 'Access denied'; end if;

  if p_action='fund' and v_payment.status='created' and v_role='payer' then
    v_next:='test_held'; v_from:='test_payer'; v_to:='test_held';
  elsif p_action='allocate' and v_payment.status='test_held' and v_role='provider' then
    if v_payment.match_status='needs_review' then raise exception 'Resolve mismatch before allocation'; end if;
    v_next:='allocated'; v_from:='test_held'; v_to:='test_provider';
  elsif p_action='resolve_match' and v_payment.status='test_held' and v_role in ('provider','admin') and v_payment.match_status='needs_review' then
    update public.pilot_payments set match_status='manually_confirmed' where id=p_payment returning * into v_payment;
    insert into public.audit_events(actor_id,resource,resource_id,action,key) values(p_actor,'payment',p_payment,p_action,p_key);
    return v_payment;
  elsif p_action='refund' and v_payment.status in ('test_held','disputed') and v_role='admin' then
    if (select coalesce(sum(case when direction='credit' then amount_minor else -amount_minor end),0)
        from public.ledger_entries where payment_id=p_payment and account='test_held') < v_payment.amount_minor then
      raise exception 'Test value already allocated; reversal workflow required';
    end if;
    v_next:='refunded'; v_from:='test_held'; v_to:='test_payer';
  elsif p_action='dispute' and v_payment.status in ('test_held','allocated') then
    v_next:='disputed';
  else raise exception 'Action unavailable at this stage'; end if;
  update public.pilot_payments set status=v_next where id=p_payment returning * into v_payment;
  if v_from is not null then
    insert into public.ledger_entries(payment_id,event_key,account,direction,amount_minor,currency) values
      (p_payment,p_key,v_from,'debit',v_payment.amount_minor,v_payment.currency),
      (p_payment,p_key,v_to,'credit',v_payment.amount_minor,v_payment.currency);
  end if;
  insert into public.audit_events(actor_id,resource,resource_id,action,key) values(p_actor,'payment',p_payment,p_action,p_key);
  return v_payment;
end $$;

-- Never expose pilot tables or transaction functions to browser API roles.
alter table public.profiles enable row level security;
alter table public.institutions enable row level security;
alter table public.fee_requests enable row level security;
alter table public.pilot_payments enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.profiles,public.institutions,public.fee_requests,public.pilot_payments,public.ledger_entries,public.audit_events from anon,authenticated;
revoke all on function public.pilot_create_payment(uuid,text,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.pilot_payment_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.pilot_create_payment(uuid,text,text,text,bigint,text) to service_role;
grant execute on function public.pilot_payment_action(uuid,uuid,text,text) to service_role;

-- After a founder signs up, set their role manually in the SQL editor:
-- update public.profiles set role='admin' where email='your-founder-email@example.com';
