import { createClient } from '@supabase/supabase-js'

// Replace these with your actual Project URL and anon public key
// from Supabase: Project Settings -> API
const SUPABASE_URL = 'https://wzyvbtzxxdcxgvbkcqmt.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_R0NGi47hsE9rpE3JQfcqxQ_i4OAYN0r'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
