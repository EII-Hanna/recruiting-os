-- RecruitingOS: launch approved recruiting campaigns to Meta in PAUSED state

alter table public.recruiting_campaigns
  add column if not exists destination_url text,
  add column if not exists creative_image_url text,
  add column if not exists meta_launch_status text not null default 'not_started'
    check (meta_launch_status in ('not_started','processing','created','failed')),
  add column if not exists meta_campaign_id text,
  add column if not exists meta_adset_id text,
  add column if not exists meta_creative_id text,
  add column if not exists meta_ad_id text,
  add column if not exists meta_launched_at timestamptz,
  add column if not exists meta_launch_error text;

create table if not exists public.meta_campaign_launches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.recruiting_campaigns(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'processing'
    check (status in ('processing','created','failed')),
  meta_ad_account_id text,
  meta_page_id text,
  meta_instagram_account_id text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.meta_campaign_launches enable row level security;

drop policy if exists meta_campaign_launches_org_access on public.meta_campaign_launches;
create policy meta_campaign_launches_org_access
  on public.meta_campaign_launches
  for select
  using (public.is_org_member(organization_id));

-- Writes happen only through the service-role Edge Function.
revoke insert, update, delete on public.meta_campaign_launches from anon, authenticated;
grant select on public.meta_campaign_launches to authenticated;

create index if not exists idx_meta_campaign_launches_org on public.meta_campaign_launches(organization_id);
create index if not exists idx_meta_campaign_launches_campaign on public.meta_campaign_launches(campaign_id, created_at desc);
