-- REVIEW DRAFT ONLY: deliberately outside supabase/migrations.
-- Do not apply or register without separate approval. Existing 0033 is unchanged.
-- Proposed pilot budget: 60-request burst, replenished at 5 lookups/second
-- globally across Edge instances. No client-selected bucket, token/hash or IP.
begin;

create table public.mcp_request_budget (
  singleton boolean primary key default true check (singleton),
  tokens numeric not null check (tokens between 0 and 60),
  refreshed_at timestamptz not null
);
insert into public.mcp_request_budget(singleton, tokens, refreshed_at)
values (true, 60, clock_timestamp());
alter table public.mcp_request_budget enable row level security;
revoke all on public.mcp_request_budget from public, anon, authenticated, service_role;

create function public.admit_mcp_request()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '100ms'
as $$
declare
  v_tokens numeric;
  v_last timestamptz;
  v_now timestamptz;
begin
  select b.tokens, b.refreshed_at into v_tokens, v_last
  from public.mcp_request_budget b where b.singleton for update;
  if not found then
    raise exception 'MCP admission unavailable' using errcode = '55000';
  end if;
  -- Sample AFTER acquiring the row lock. Never move its clock backwards.
  v_now := greatest(clock_timestamp(), v_last);
  v_tokens := least(60, v_tokens + extract(epoch from (v_now - v_last)) * 5);
  if v_tokens < 1 then
    return query select false, 1;
    return;
  end if;
  update public.mcp_request_budget
  set tokens = v_tokens - 1, refreshed_at = v_now where singleton;
  return query select true, 0;
end;
$$;

revoke all on function public.admit_mcp_request() from public, anon, authenticated, service_role;
grant execute on function public.admit_mcp_request() to service_role;
notify pgrst, 'reload schema';
commit;
