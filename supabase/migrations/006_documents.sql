-- RecruitingOS: Dokumenten- und CV-Cockpit

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recruiting-documents',
  'recruiting-documents',
  false,
  15728640,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  document_type text not null default 'other' check (document_type in ('cv','job_description','contract','certificate','reference','presentation','other')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint,
  notes text,
  ai_status text not null default 'not_processed' check (ai_status in ('not_processed','queued','processing','processed','error')),
  ai_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_exactly_one_parent check (
    ((candidate_id is not null)::int + (job_id is not null)::int + (company_id is not null)::int) = 1
  )
);

alter table public.documents enable row level security;

drop policy if exists documents_org_access on public.documents;
create policy documents_org_access
  on public.documents
  for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists recruiting_documents_select on storage.objects;
create policy recruiting_documents_select
  on storage.objects for select
  using (
    bucket_id = 'recruiting-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists recruiting_documents_insert on storage.objects;
create policy recruiting_documents_insert
  on storage.objects for insert
  with check (
    bucket_id = 'recruiting-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists recruiting_documents_update on storage.objects;
create policy recruiting_documents_update
  on storage.objects for update
  using (
    bucket_id = 'recruiting-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'recruiting-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists recruiting_documents_delete on storage.objects;
create policy recruiting_documents_delete
  on storage.objects for delete
  using (
    bucket_id = 'recruiting-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create index if not exists idx_documents_org_created on public.documents(organization_id, created_at desc);
create index if not exists idx_documents_candidate on public.documents(candidate_id);
create index if not exists idx_documents_job on public.documents(job_id);
create index if not exists idx_documents_company on public.documents(company_id);
