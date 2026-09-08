import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Fail loud at boot rather than mysteriously later on the first request.
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in your " +
      "environment (Railway -> Variables, or a local .env file)."
  );
}

// This client uses the service role key, so it bypasses Row Level Security.
// That's intentional: RLS protects direct browser access to Supabase, but
// this server is the trusted backend and needs to read/write freely.
// NEVER send this key to the browser or commit it to source control.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
