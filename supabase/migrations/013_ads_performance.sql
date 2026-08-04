-- RecruitingOS: Meta lead attribution and campaign performance

alter table public.funnel_submissions alter column funnel_id drop not null;

alter table public.funnel_submissions
  add column if not exists meta_lead_id text,
  add column if not exists meta_form_id text,
  add column if not exists meta_ad_id text,
  add column if not exists meta_adset_id text,
  add column if not exists meta_campaign_id text,
  add column if not exists creative_name text,
  add column if not exists qualified_at timestamptz,
  add column if not exists interview_at timestamptz,
  add column if not exists hired_at timestamptz;

create unique index if not exists idx_funnel_submissions_meta_lead_unique
  on public.funnel_submissions(meta_lead_id)
  where meta_lead_id is not null;

create table if not exists public.campaign_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.recruiting_campaigns(id) on delete cascade,
  insight_date date not null,
  source text not null default 'meta' check (source in ('meta','funnel','manual')),
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  spend numeric(12,2) not null default 0,
  leads integer not null default 0,
  qualified_leads integer not null default 0,
  interviews integer not null default 0,
  hires integer not null default 0,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, insight_date, source)
);

create table if not exists public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  event_type text not null,
  external_id text,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.campaign_insights enable row level security;
alter table public.meta_webhook_events enable row level security;

drop policy if exists campaign_insights_org_access on public.campaign_insights;
create policy campaign_insights_org_access on public.campaign_insights for all
using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists meta_webhook_events_org_select on public.meta_webhook_events;
create policy meta_webhook_events_org_select on public.meta_webhook_events for select
using (organization_id is not null and public.is_org_member(organization_id));

create index if not exists idx_campaign_insights_campaign_date on public.campaign_insights(campaign_id, insight_date desc);
create index if not exists idx_campaign_insights_org_date on public.campaign_insights(organization_id, insight_date desc);
create index if not exists idx_meta_webhook_events_external on public.meta_webhook_events(external_id);
create index if not exists idx_funnel_submissions_campaign_created on public.funnel_submissions(campaign_id, created_at desc);
