-- RecruitingOS: public application funnels and candidate submissions

create table if not exists public.application_funnels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.recruiting_campaigns(id) on delete set null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  slug text not null unique,
  status text not null default 'draft' check (status in ('draft','published','paused','archived')),
  headline text,
  intro_text text,
  thank_you_text text default 'Vielen Dank! Wir melden uns schnellstmöglich bei dir.',
  questions jsonb not null default '[]'::jsonb,
  privacy_text text not null default 'Ich stimme der Verarbeitung meiner Angaben zur Bearbeitung meiner Bewerbung zu.',
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.funnel_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  funnel_id uuid not null references public.application_funnels(id) on delete cascade,
  campaign_id uuid references public.recruiting_campaigns(id) on delete set null,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  answers jsonb not null default '{}'::jsonb,
  consent_given boolean not null default false,
  consent_at timestamptz,
  source text not null default 'recruiting_funnel',
  status text not null default 'new' check (status in ('new','processed','duplicate','rejected')),
  created_at timestamptz not null default now()
);

alter table public.application_funnels enable row level security;
alter table public.funnel_submissions enable row level security;

drop policy if exists application_funnels_org_access on public.application_funnels;
create policy application_funnels_org_access on public.application_funnels
for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

drop policy if exists funnel_submissions_org_access on public.funnel_submissions;
create policy funnel_submissions_org_access on public.funnel_submissions
for select using (public.is_org_member(organization_id));

create index if not exists idx_application_funnels_org on public.application_funnels(organization_id);
create index if not exists idx_application_funnels_slug on public.application_funnels(slug);
create index if not exists idx_funnel_submissions_funnel on public.funnel_submissions(funnel_id, created_at desc);
create index if not exists idx_funnel_submissions_candidate on public.funnel_submissions(candidate_id);
