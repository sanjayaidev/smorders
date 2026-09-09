-- WhatsApp bot: conversation state, message log, settings, and admin-editable
-- keyword automations. Kept as its own set of tables so the bot never has to
-- touch orders/products directly except at the very end (creating the order).

create extension if not exists pgcrypto;

-- One row per customer phone number ("wa_id" from Meta, digits only, e.g.
-- "77001234567"). This is the whole state machine for the order-taking
-- chain: stage tracks where the customer is in Name -> Table -> Items ->
-- Confirm, and cart holds what's been matched so far.
create table if not exists public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  profile_name text,
  stage text not null default 'idle'
    check (stage in ('idle', 'ask_name', 'ask_table', 'ask_items', 'confirm')),
  customer_name text,
  table_no text,
  cart jsonb not null default '[]'::jsonb,
  last_message_at timestamptz not null default now(),
  -- Date (server-local) the daily welcome message was last sent, so we only
  -- greet once per day rather than on every message.
  last_greeted_date date,
  followup_sent boolean not null default false,
  created_at timestamptz not null default now()
);

-- Inbound + outbound message log. Primary-keyed on WhatsApp's own message id
-- so webhook retries (Meta resends on any non-2xx or timeout) can't process
-- the same message twice - insert just fails silently on conflict.
create table if not exists public.wa_messages (
  id text primary key,
  conversation_id uuid references public.wa_conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text,
  created_at timestamptz not null default now()
);
create index if not exists wa_messages_conversation_idx on public.wa_messages (conversation_id, created_at);

-- Singleton settings row (id is always 1) - welcome message + buttons, and
-- the follow-up nudge sent if a customer goes quiet mid-conversation.
create table if not exists public.wa_settings (
  id smallint primary key default 1 check (id = 1),
  welcome_message text not null default
    E'👋 Welcome! I''m here to help you order.\n\nWhat would you like to do?',
  order_button_label text not null default '🛒 Place an order',
  location_button_label text not null default '📍 Location',
  menu_button_label text not null default '💰 Menu & prices',
  followup_message text not null default
    'Still there? Just reply whenever you''re ready to continue 🙂',
  followup_delay_minutes int not null default 15,
  owner_whatsapp_number text,
  updated_at timestamptz not null default now()
);
insert into public.wa_settings (id) values (1) on conflict (id) do nothing;

-- Admin-managed keyword -> auto-reply rules (the "keyword automation
-- maker"). Checked on every inbound message that isn't a structured answer
-- to the built-in order-taking chain.
create table if not exists public.wa_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  match_type text not null default 'contains' check (match_type in ('contains', 'exact')),
  response text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.wa_keywords (keyword, match_type, response, sort_order)
select * from (values
  ('location', 'contains', 'Edit this reply in the admin panel with your real address and a map link 📍', 0),
  ('hours', 'contains', 'Edit this reply in the admin panel with your real opening hours 🕒', 1),
  ('price', 'contains', 'You can see our full menu and prices any time - just ask, or tap "Menu & prices" 💰', 2)
) as seed(keyword, match_type, response, sort_order)
where not exists (select 1 from public.wa_keywords);
