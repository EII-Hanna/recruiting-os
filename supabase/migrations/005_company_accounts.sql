-- RecruitingOS: Unternehmensakte und Ansprechpartner

alter table public.companies
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists postal_code text,
  add column if not exists country text default 'Deutschland',
  add column if not exists customer_status text default 'prospect',
  add column if not exists potential_value numeric(12,2),
  add column if not exists notes text,
  add column if not exists archived_at timestamptz;

create table if not exists public.company_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  job_title text,
  email text,
  phone text,
  linkedin_url text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.company_contacts enable row level security;

drop policy if exists company_contacts_org_access on public.company_contacts;
create policy company_contacts_org_access
  on public.company_contacts
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

alter table public.tasks add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.activities add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists idx_company_contacts_org_company on public.company_contacts(organization_id, company_id);
create index if not exists idx_tasks_company on public.tasks(company_id);
create index if not exists idx_activities_company on public.activities(company_id);
