import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabase = !!(url && anon);

export const supabase = hasSupabase
  ? createClient(url!, anon!, {
      auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false },
    })
  : null;
