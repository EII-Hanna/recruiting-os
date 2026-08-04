-- RecruitingOS: KI-CV-Auswertung

create table if not exists public.cv_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','approved','rejected')),
  provider text not null default 'openai',
  model text,
  extracted_data jsonb not null default '{}'::jsonb,
  confidence jsonb not null default '{}'::jsonb,
  warnings text[] not null default '{}',
  error_message text,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(candidate_id, document_id)
);

alter table public.candidates
  add column if not exists professional_summary text,
  add column if not exists years_experience numeric(5,1),
  add column if not exists education jsonb not null default '[]'::jsonb,
  add column if not exists work_experience jsonb not null default '[]'::jsonb,
  add column if not exists languages jsonb not null default '[]'::jsonb,
  add column if not exists certifications jsonb not null default '[]'::jsonb,
  add column if not exists availability_date date,
  add column if not exists notice_period text,
  add column if not exists cv_last_analyzed_at timestamptz;

alter table public.cv_analyses enable row level security;

drop policy if exists cv_analyses_org_access on public.cv_analyses;
create policy cv_analyses_org_access
  on public.cv_analyses
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create index if not exists idx_cv_analyses_candidate_created on public.cv_analyses(candidate_id, created_at desc);
create index if not exists idx_cv_analyses_status on public.cv_analyses(organization_id, status);
