-- Supabase-backed chatbot builder data. This replaces external Docs/Sheets
-- configuration with knowledge entries managed in the admin builder.
create extension if not exists pgcrypto;

create table if not exists public.wb_bot_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'plaintext',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wb_bot_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  keywords text[] not null default '{}',
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  action_type text not null default 'template',
  action_template_id uuid references public.wb_bot_templates(id) on delete set null,
  ai_prompt text not null default '',
  ai_fallback text not null default '',
  action_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  else_template_id uuid references public.wb_bot_templates(id) on delete set null,
  follow_up jsonb not null default '{"enabled":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wb_knowledge_base (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  active boolean not null default true,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wb_knowledge_base_active_idx
  on public.wb_knowledge_base (active, priority desc);

-- The order flow owns these commands. They must not be shadowed by builder rules.
create or replace function public.reject_order_system_keyword()
returns trigger
language plpgsql
as $$
declare
  keyword text;
  reserved text[] := array[
    'order', 'confirm', 'confirm_order', 'place order', 'cancel', 'restart',
    'reset', 'menu', 'location', 'price', 'add / change', 'modify_order'
  ];
begin
  foreach keyword in array coalesce(new.keywords, '{}') loop
    if lower(trim(keyword)) = any(reserved) then
      raise exception 'Keyword "%" is reserved by the order system.', keyword
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists wb_bot_rules_reserved_keyword on public.wb_bot_rules;
create trigger wb_bot_rules_reserved_keyword
before insert or update of keywords on public.wb_bot_rules
for each row execute function public.reject_order_system_keyword();
