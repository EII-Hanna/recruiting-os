-- Candidate readiness, anonymized profiles, customer submissions and follow-ups

create table if not exists public.candidate_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  consent_type text not null default 'privacy',
  status text not null default 'confirmed' check (status in ('pending','confirmed','revoked')),
  confirmation_method text not null default 'call',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,candidate_id,consent_type)
);

create table if not exists public.candidate_readiness (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  discovery_completed boolean not null default false,
  privacy_confirmed boolean not null default false,
  cv_received boolean not null default false,
  references_received boolean not null default false,
  salary_captured boolean not null default false,
  availability_captured boolean not null default false,
  matching_released boolean not null default false,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,candidate_id)
);

create table if not exists public.candidate_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  profile_type text not null default 'anonymous' check (profile_type in ('anonymous','customer')),
  version integer not null default 1,
  title text,
  summary text,
  profile_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,candidate_id,profile_type,version)
);

create table if not exists public.candidate_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  profile_id uuid references public.candidate_profiles(id) on delete set null,
  contact_name text,
  contact_email text,
  subject text,
  email_body text,
  status text not null default 'prepared' check (status in ('prepared','sent','follow_up_due','interested','interview','rejected','placed')),
  sent_at timestamptz,
  first_follow_up_at timestamptz,
  call_follow_up_at timestamptz,
  last_contact_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.submission_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null references public.candidate_submissions(id) on delete cascade,
  activity_type text not null check (activity_type in ('prepared','email_sent','follow_up_email','call_due','called','response','status_changed')),
  body text,
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.candidate_consents enable row level security;
alter table public.candidate_readiness enable row level security;
alter table public.candidate_profiles enable row level security;
alter table public.candidate_submissions enable row level security;
alter table public.submission_activities enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='candidate_consents' and policyname='candidate_consents_org_access') then
    create policy candidate_consents_org_access on public.candidate_consents for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='candidate_readiness' and policyname='candidate_readiness_org_access') then
    create policy candidate_readiness_org_access on public.candidate_readiness for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='candidate_profiles' and policyname='candidate_profiles_org_access') then
    create policy candidate_profiles_org_access on public.candidate_profiles for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='candidate_submissions' and policyname='candidate_submissions_org_access') then
    create policy candidate_submissions_org_access on public.candidate_submissions for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='submission_activities' and policyname='submission_activities_org_access') then
    create policy submission_activities_org_access on public.submission_activities for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
  end if;
end $$;

create index if not exists idx_candidate_readiness_candidate on public.candidate_readiness(candidate_id);
create index if not exists idx_candidate_profiles_candidate on public.candidate_profiles(candidate_id,created_at desc);
create index if not exists idx_candidate_submissions_candidate on public.candidate_submissions(candidate_id,created_at desc);
create index if not exists idx_candidate_submissions_company on public.candidate_submissions(company_id,status,created_at desc);
create index if not exists idx_submission_activities_submission on public.submission_activities(submission_id,occurred_at desc);
