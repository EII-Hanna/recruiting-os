-- RecruitingOS: Recruiting Ads Cockpit

create table if not exists public.recruiting_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','generated','approved','paused','active','completed','archived')),
  objective text not null default 'lead_generation',
  special_ad_category text not null default 'EMPLOYMENT',
  daily_budget numeric(12,2),
  duration_days integer,
  radius_km integer,
  target_cpl numeric(12,2),
  hires_needed integer default 1,
  benefits text[] not null default '{}',
  audience_notes text,
  campaign_angle text,
  generation_status text not null default 'not_started' check (generation_status in ('not_started','processing','completed','failed')),
  generated_package jsonb,
  generation_error text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.recruiting_campaigns(id) on delete cascade,
  variant_type text not null check (variant_type in ('hook','primary_text','headline','description','cta','creative_brief')),
  angle text,
  content text not null,
  sort_order integer not null default 0,
  is_selected boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.recruiting_campaigns(id) on delete cascade,
  approval_type text not null default 'campaign_package',
  status text not null check (status in ('pending','approved','rejected')),
  notes text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.recruiting_campaigns enable row level security;
alter table public.campaign_variants enable row level security;
alter table public.campaign_approvals enable row level security;

drop policy if exists recruiting_campaigns_org_access on public.recruiting_campaigns;
create policy recruiting_campaigns_org_access on public.recruiting_campaigns for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists campaign_variants_org_access on public.campaign_variants;
create policy campaign_variants_org_access on public.campaign_variants for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists campaign_approvals_org_access on public.campaign_approvals;
create policy campaign_approvals_org_access on public.campaign_approvals for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create index if not exists idx_recruiting_campaigns_org on public.recruiting_campaigns(organization_id, created_at desc);
create index if not exists idx_recruiting_campaigns_job on public.recruiting_campaigns(job_id);
create index if not exists idx_campaign_variants_campaign on public.campaign_variants(campaign_id, sort_order);
create index if not exists idx_campaign_approvals_campaign on public.campaign_approvals(campaign_id, created_at desc);
