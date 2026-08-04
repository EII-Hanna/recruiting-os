-- RecruitingOS: Meta OAuth connections and asset selection

create table if not exists public.meta_oauth_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  connected_by uuid references auth.users(id) on delete set null,
  meta_user_id text,
  meta_user_name text,
  access_token text not null,
  token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  businesses jsonb not null default '[]'::jsonb,
  ad_accounts jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,
  selected_business_id text,
  selected_ad_account_id text,
  selected_page_id text,
  selected_instagram_account_id text,
  status text not null default 'connected' check (status in ('connected','expired','revoked','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_oauth_states enable row level security;
alter table public.meta_connections enable row level security;

-- OAuth state and tokens are server-only. Service-role Edge Functions bypass RLS.
revoke all on public.meta_oauth_states from anon, authenticated;
revoke all on public.meta_connections from anon, authenticated;

create or replace view public.meta_connection_status
with (security_invoker = true)
as
select
  id,
  organization_id,
  meta_user_id,
  meta_user_name,
  businesses,
  ad_accounts,
  pages,
  selected_business_id,
  selected_ad_account_id,
  selected_page_id,
  selected_instagram_account_id,
  status,
  last_synced_at,
  last_error,
  created_at,
  updated_at
from public.meta_connections
where public.is_org_member(organization_id);

grant select on public.meta_connection_status to authenticated;

create index if not exists idx_meta_oauth_states_state on public.meta_oauth_states(state);
create index if not exists idx_meta_oauth_states_expiry on public.meta_oauth_states(expires_at);
create index if not exists idx_meta_connections_org on public.meta_connections(organization_id);
