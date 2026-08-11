import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Reads publishable config only — the service
// role key must never appear here (PAY-04 / SEC-14). Requires
// NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to be set once a
// Supabase project exists (see .env.example).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
