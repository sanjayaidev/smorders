-- The webhook verify token is no longer editable from the admin UI or
-- stored in the database - it's read directly from the WHATSAPP_VERIFY_TOKEN
-- environment variable (see src/lib/waConnection.js). Drop the column so
-- there's exactly one place this value can live.
alter table public.wa_connection drop column if exists verify_token;
