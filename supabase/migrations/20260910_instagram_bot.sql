-- Instagram DM bot: same shape as the WhatsApp bot (see 20260909_whatsapp_bot.sql
-- and 20260909_whatsapp_connection.sql), adapted for Instagram Messaging.
-- Kept as its own set of tables so neither channel's bot has to know the
-- other exists, beyond both eventually writing to orders/order_items.

create extension if not exists pgcrypto;

-- Singleton connection row. Instagram DM automation runs through a Facebook
-- Page that's linked to an Instagram professional account, so we store the
-- Page ID (used to call /me/messages), the linked IG user id + username
-- (mostly for display, and for matching the account the admin pasted a
-- profile URL for), and the Page access token used to send messages.
--
-- No verify_token column: unlike wa_connection, the Instagram webhook verify
-- token is never stored in the DB or shown in the admin UI - it's read
-- straight from the INSTAGRAM_VERIFY_TOKEN (or shared META_VERIFY_TOKEN)
-- environment variable, same as WhatsApp's.
create table if not exists public.ig_connection (
  id smallint primary key default 1 check (id = 1),
  page_id text,
  ig_user_id text,
  ig_username text,
  access_token text,
  app_secret text,
  updated_at timestamptz not null default now()
);
insert into public.ig_connection (id) values (1) on conflict (id) do nothing;

-- One row per Instagram-scoped sender id ("IGSID" from Meta).
create table if not exists public.ig_conversations (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null unique,
  profile_name text,
  stage text not null default 'idle'
    check (stage in ('idle', 'ask_name', 'ask_table', 'ask_items', 'confirm')),
  customer_name text,
  table_no text,
  cart jsonb not null default '[]'::jsonb,
  last_message_at timestamptz not null default now(),
  last_greeted_date date,
  followup_sent boolean not null default false,
  created_at timestamptz not null default now()
);

-- Inbound + outbound message log, primary-keyed on Instagram's own message
-- id (mid) so webhook retries can't double-process the same message.
create table if not exists public.ig_messages (
  id text primary key,
  conversation_id uuid references public.ig_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text,
  created_at timestamptz not null default now()
);
create index if not exists ig_messages_conversation_idx on public.ig_messages (conversation_id, created_at);

-- Singleton settings row - same fields as wa_settings.
create table if not exists public.ig_settings (
  id smallint primary key default 1 check (id = 1),
  welcome_message text not null default
    E'👋 Welcome! I''m here to help you order.\n\nWhat would you like to do?',
  order_button_label text not null default '🛒 Place an order',
  location_button_label text not null default '📍 Location',
  menu_button_label text not null default '💰 Menu & prices',
  followup_message text not null default
    'Still there? Just reply whenever you''re ready to continue 🙂',
  followup_delay_minutes int not null default 15,
  owner_ig_sender_id text,
  updated_at timestamptz not null default now()
);
insert into public.ig_settings (id) values (1) on conflict (id) do nothing;

-- Admin-managed keyword -> auto-reply rules, same shape as wa_keywords.
create table if not exists public.ig_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  response text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.ig_keywords (keyword, match_type, response, sort_order)
select * from (values
  ('location', 'contains', 'Edit this reply in the admin panel with your real address and a map link 📍', 0),
  ('hours', 'contains', 'Edit this reply in the admin panel with your real opening hours 🕒', 1),
  ('price', 'contains', 'You can see our full menu and prices any time - just ask, or tap "Menu & prices" 💰', 2)
) as seed(keyword, match_type, response, sort_order)
where not exists (select 1 from public.ig_keywords);
