create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  account_email text,
  status text not null default 'disconnected' check (status in ('disconnected','connected','error')),
  scopes text[] not null default '{}',
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,provider)
);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  provider_message_id text not null,
  thread_id text,
  direction text not null check (direction in ('inbound','outbound','draft')),
  sender_email text,
  recipient_emails text[] not null default '{}',
  subject text,
  snippet text,
  body_text text,
  candidate_id uuid references public.candidates(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id,provider_message_id)
);

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid references public.integrations(id) on delete set null,
  provider_event_id text not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  attendee_emails text[] not null default '{}',
  candidate_id uuid references public.candidates(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  application_id uuid references public.applications(id) on delete set null,
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,provider_event_id)
);

alter table public.integrations enable row level security;
alter table public.email_messages enable row level security;
alter table public.calendar_events enable row level security;

create policy integrations_org_access on public.integrations for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy email_messages_org_access on public.email_messages for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy calendar_events_org_access on public.calendar_events for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

create index if not exists idx_integrations_org_provider on public.integrations(organization_id,provider);
create index if not exists idx_email_messages_org_received on public.email_messages(organization_id,received_at desc);
create index if not exists idx_calendar_events_org_start on public.calendar_events(organization_id,starts_at);
