-- RecruitingOS: Kandidatenqualifizierung

alter table public.candidates
  add column if not exists desired_title text,
  add column if not exists desired_locations text[] not null default '{}',
  add column if not exists remote_preference text,
  add column if not exists notice_period text,
  add column if not exists availability_date date,
  add column if not exists motivation text,
  add column if not exists exclusion_criteria text[] not null default '{}',
  add column if not exists qualification_summary text,
  add column if not exists qualification_status text not null default 'open' check (qualification_status in ('open','in_progress','complete','approved')),
  add column if not exists matching_approved boolean not null default false,
  add column if not exists qualified_at timestamptz,
  add column if not exists qualified_by uuid references auth.users(id) on delete set null;

create table if not exists public.candidate_qualification_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  question_key text not null,
  question_label text not null,
  answer_text text,
  is_required boolean not null default false,
  completed boolean not null default false,
  source text not null default 'manual' check (source in ('manual','cv','ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(candidate_id, question_key)
);

alter table public.candidate_qualification_answers enable row level security;

drop policy if exists candidate_qualification_answers_org_access on public.candidate_qualification_answers;
create policy candidate_qualification_answers_org_access
  on public.candidate_qualification_answers
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create index if not exists idx_candidate_qualification_answers_candidate
  on public.candidate_qualification_answers(organization_id, candidate_id);
