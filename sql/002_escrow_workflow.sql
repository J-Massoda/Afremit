-- Test-only release verification. Run after 001_pilot.sql.
-- No external funds, custody, bank, or payment provider is connected.
begin;

alter table public.fee_requests add column if not exists release_condition text not null default 'Afremit reviewer checks provider evidence before simulated release.';
alter table public.fee_requests drop constraint if exists fee_requests_release_condition_length;
alter table public.fee_requests add constraint fee_requests_release_condition_length check (char_length(trim(release_condition)) between 1 and 500);

alter table public.pilot_payments add column if not exists release_condition text not null default 'Afremit reviewer checks provider evidence before simulated release.';
alter table public.pilot_payments add column if not exists accepted_at timestamptz;
alter table public.pilot_payments add column if not exists evidence_status text not null default 'awaiting';
alter table public.pilot_payments add column if not exists evidence_note text not null default '';
alter table public.pilot_payments add column if not exists verification_note text not null default '';
alter table public.pilot_payments add column if not exists verified_by uuid references public.profiles(id);
alter table public.pilot_payments drop constraint if exists pilot_payments_evidence_status_check;
alter table public.pilot_payments add constraint pilot_payments_evidence_status_check check (evidence_status in ('awaiting','submitted','verified'));
alter table public.audit_events add column if not exists note text not null default '';

-- Remove the earlier four-argument RPCs. They allowed provider-only allocation.
drop function if exists public.pilot_create_payment(uuid,text,text,text,bigint,text);
drop function if exists public.pilot_payment_action(uuid,uuid,text,text);

create function public.pilot_create_payment(p_actor uuid,p_code text,p_currency text,p_key text,p_amount bigint,p_reference text,p_accept boolean)
returns public.pilot_payments language plpgsql security definer set search_path = public as $$
declare v_req public.fee_requests; v_payment public.pilot_payments;
begin
  if p_key is null or char_length(p_key) not between 1 and 100 then raise exception 'Invalid submission key'; end if;
  if p_accept is distinct from true then raise exception 'Release conditions must be accepted'; end if;
  if p_currency not in ('GBP','EUR','USD','CAD','ZAR','NGN','GHS','KES','XAF','XOF') then raise exception 'Invalid currency'; end if;
  if p_amount not between 1 and 100000000000 or p_reference is null or char_length(trim(p_reference)) not between 1 and 100 then raise exception 'Invalid payment details'; end if;
  if exists(select 1 from public.profiles where id=p_actor and role='admin') then raise exception 'Use a payer account'; end if;
  select * into v_payment from public.pilot_payments where payer_id=p_actor and idempotency_key=p_key;
  if found then return v_payment; end if;
  select r.* into v_req from public.fee_requests r join public.institutions i on i.id=r.institution_id
    where r.code=p_code and i.status='pilot_approved';
  if not found then raise exception 'Request unavailable'; end if;
  if v_req.created_by=p_actor then raise exception 'Provider cannot pay own request'; end if;
  insert into public.pilot_payments(request_id,payer_id,amount_minor,currency,payer_currency,payer_reference,match_status,idempotency_key,release_condition,accepted_at)
    values(v_req.id,p_actor,p_amount,v_req.currency,p_currency,trim(p_reference),
      case when p_amount=v_req.amount_minor and lower(trim(p_reference))=lower(trim(v_req.reference)) then 'exact' else 'needs_review' end,
      p_key,v_req.release_condition,now()) returning * into v_payment;
  insert into public.audit_events(actor_id,resource,resource_id,action,key) values(p_actor,'payment',v_payment.id,'created',p_key);
  return v_payment;
end $$;

create function public.pilot_payment_action(p_actor uuid,p_payment uuid,p_action text,p_key text,p_note text)
returns public.pilot_payments language plpgsql security definer set search_path = public as $$
declare v_payment public.pilot_payments; v_req public.fee_requests; v_owner uuid; v_role text; v_next text; v_from text; v_to text; v_note text := trim(coalesce(p_note,''));
begin
  if p_key is null or char_length(p_key) not between 1 and 100 then raise exception 'Invalid action key'; end if;
  select * into v_payment from public.pilot_payments where id=p_payment for update;
  if not found then raise exception 'Payment unavailable'; end if;
  select r,i.owner_id into v_req,v_owner from public.fee_requests r join public.institutions i on i.id=r.institution_id where r.id=v_payment.request_id;
  if exists(select 1 from public.profiles where id=p_actor and role='admin') then v_role := 'admin';
  elsif p_actor=v_payment.payer_id then v_role := 'payer';
  elsif p_actor=v_owner then v_role := 'provider';
  else raise exception 'Access denied'; end if;
  if exists(select 1 from public.audit_events where resource='payment' and resource_id=p_payment and key=p_key) then return v_payment; end if;
  if p_action in ('submit_evidence','verify_release','resolve_match','dispute','refund') and char_length(v_note) not between 1 and 800 then raise exception 'A decision or evidence note is required'; end if;

  if p_action='fund' and v_payment.status='created' and v_role='payer' then
    v_next:='test_held'; v_from:='test_payer'; v_to:='test_held';
  elsif p_action='submit_evidence' and v_payment.status='test_held' and v_role='provider' then
    update public.pilot_payments set evidence_status='submitted',evidence_note=v_note,verification_note='',verified_by=null where id=p_payment returning * into v_payment;
    insert into public.audit_events(actor_id,resource,resource_id,action,key,note) values(p_actor,'payment',p_payment,p_action,p_key,v_note);
    return v_payment;
  elsif p_action='resolve_match' and v_payment.status='test_held' and v_role='admin' and v_payment.match_status='needs_review' then
    if v_payment.amount_minor<>v_req.amount_minor then raise exception 'Amount mismatch requires corrected request'; end if;
    update public.pilot_payments set match_status='manually_confirmed' where id=p_payment returning * into v_payment;
    insert into public.audit_events(actor_id,resource,resource_id,action,key,note) values(p_actor,'payment',p_payment,p_action,p_key,v_note);
    return v_payment;
  elsif p_action='verify_release' and v_payment.status='test_held' and v_role='admin' then
    if v_payment.accepted_at is null or v_payment.evidence_status<>'submitted' or v_payment.match_status='needs_review' or v_payment.amount_minor<>v_req.amount_minor then raise exception 'Payer agreement, evidence and exact amount require review'; end if;
    update public.pilot_payments set evidence_status='verified',verification_note=v_note,verified_by=p_actor where id=p_payment returning * into v_payment;
    insert into public.audit_events(actor_id,resource,resource_id,action,key,note) values(p_actor,'payment',p_payment,p_action,p_key,v_note);
    return v_payment;
  elsif p_action='allocate' and v_payment.status='test_held' and v_role='admin' then
    if v_payment.evidence_status<>'verified' or v_payment.match_status='needs_review' then raise exception 'Review evidence and match before simulated release'; end if;
    v_next:='allocated'; v_from:='test_held'; v_to:='test_provider';
  elsif p_action='refund' and v_payment.status in ('test_held','disputed') and v_role='admin' then
    if (select coalesce(sum(case when direction='credit' then amount_minor else -amount_minor end),0)
        from public.ledger_entries where payment_id=p_payment and account='test_held') < v_payment.amount_minor then raise exception 'Test value already allocated'; end if;
    v_next:='refunded'; v_from:='test_held'; v_to:='test_payer';
  elsif p_action='dispute' and v_payment.status='test_held' and v_role in ('payer','provider','admin') then
    v_next:='disputed';
  else raise exception 'Action unavailable at this stage'; end if;

  update public.pilot_payments set status=v_next where id=p_payment returning * into v_payment;
  if v_from is not null then
    insert into public.ledger_entries(payment_id,event_key,account,direction,amount_minor,currency) values
      (p_payment,p_key,v_from,'debit',v_payment.amount_minor,v_payment.currency),
      (p_payment,p_key,v_to,'credit',v_payment.amount_minor,v_payment.currency);
  end if;
  insert into public.audit_events(actor_id,resource,resource_id,action,key,note) values(p_actor,'payment',p_payment,p_action,p_key,v_note);
  return v_payment;
end $$;

revoke all on function public.pilot_create_payment(uuid,text,text,text,bigint,text,boolean) from public,anon,authenticated;
revoke all on function public.pilot_payment_action(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.pilot_create_payment(uuid,text,text,text,bigint,text,boolean) to service_role;
grant execute on function public.pilot_payment_action(uuid,uuid,text,text,text) to service_role;
commit;
