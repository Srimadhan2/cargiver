import { createClient } from "@supabase/supabase-js";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "";
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";

const fallbackAuth = {
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  signInWithPassword: async () => ({ data: { session: null, user: null }, error: null }),
  signUp: async () => ({ data: { session: null, user: null }, error: null }),
  signInWithOAuth: async () => ({ data: {}, error: null }),
  signOut: async () => ({ error: null }),
};

const createFallbackSupabase = () => ({ auth: fallbackAuth }) as any;

const createSupabaseClient = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return createFallbackSupabase();
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createSupabaseClient();
