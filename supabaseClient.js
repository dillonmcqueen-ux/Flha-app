import { createClient } from '@supabase/supabase-js'

// Replace these with your actual Project URL and anon public key
// from Supabase: Project Settings -> API
const SUPABASE_URL = 'https://YOUR_PROJECT_URL.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
