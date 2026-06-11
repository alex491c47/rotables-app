// Supabase connection. The URL and publishable key are safe to ship in the app —
// they are designed to be public; data access is governed by the database's
// row-level security rules (added at the sign-in step). The secret service_role
// key must NEVER appear here.
//
// Values can be overridden by Vercel/Vite environment variables if you ever
// rotate them, otherwise the project defaults below are used.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://wtfxuuaxwzuakxswlecm.supabase.co';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_JOwXjI86yYPugnW0FTATXg_mLVCX_t9';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
