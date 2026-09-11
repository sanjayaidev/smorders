-- Raw log of every inbound webhook POST from Meta, for both WhatsApp and
-- Instagram, regardless of whether it was a real customer message, a
-- status/delivery-receipt-only payload, or Meta's dashboard "Test" button.
--
-- This is deliberately separate from wa_messages / ig_messages: those only
-- record messages that made it through to the bot's conversation logic
-- (text/interactive/button types tied to a real sender). This table exists
-- purely so the admin can see "did anything hit my webhook at all", which
-- is exactly what's hard to answer from Railway logs alone.

create extension if not exists pgcrypto;

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('whatsapp', 'instagram')),
  -- Full JSON body Meta sent, so the admin can inspect a test payload's
  -- exact shape without needing log access.
  payload jsonb not null default '{}'::jsonb,
  -- null = no app secret configured (verification skipped), true/false =
  -- actual X-Hub-Signature-256 check result.
  signature_valid boolean,
  -- How many inbound messages this payload actually contained. 0 usually
  -- means a test webhook or a status-only update (delivered/read receipts).
  message_count int not null default 0,
  is_test boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists webhook_events_platform_created_idx
  on public.webhook_events (platform, created_at desc);
