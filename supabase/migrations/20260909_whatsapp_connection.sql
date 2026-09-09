-- Lets the admin connect WhatsApp from the UI (paste WABA ID + access token,
-- pick a phone number) instead of hand-editing environment variables.
-- Singleton row, same pattern as wa_settings.

create table if not exists public.wa_connection (
  id smallint primary key default 1 check (id = 1),
  waba_id text,
  access_token text,
  app_secret text,
  phone_number_id text,
  phone_number_display text,
  -- Auto-generated so the admin has something to paste into Meta's webhook
  -- config immediately, without needing to invent a value themselves.
  verify_token text not null default encode(gen_random_bytes(16), 'hex'),
  updated_at timestamptz not null default now()
);
insert into public.wa_connection (id) values (1) on conflict (id) do nothing;
