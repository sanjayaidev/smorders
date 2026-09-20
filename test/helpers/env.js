// The Supabase client is created at import time; give it harmless values so
// unit tests can import bot modules without a real project.
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-key";
