create table if not exists public.oauth_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  state_token text not null unique,
  redirect_uri text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.oauth_states enable row level security;
create policy oauth_states_org_access on public.oauth_states
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

alter table public.integrations
  add column if not exists sync_status text not null default 'idle'
    check (sync_status in ('idle','running','error')),
  add column if not exists last_email_sync_at timestamptz,
  add column if not exists last_calendar_sync_at timestamptz,
  add column if not exists gmail_history_id text,
  add column if not exists calendar_sync_token text,
  add column if not exists error_message text;

create table if not exists public.integration_sync_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  sync_type text not null check (sync_type in ('gmail','calendar','drive')),
  status text not null check (status in ('started','success','error')),
  records_processed integer not null default 0,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.integration_sync_logs enable row level security;
create policy integration_sync_logs_org_access on public.integration_sync_logs
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create index if not exists idx_oauth_states_token on public.oauth_states(state_token);
create index if not exists idx_oauth_states_expiry on public.oauth_states(expires_at);
create index if not exists idx_sync_logs_integration on public.integration_sync_logs(integration_id,started_at desc);
