// lib/supabase.ts - SIMPLIFIED & FIXED
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://qdpezamsvwxpvielmfcy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkcGV6YW1zdnd4cHZpZWxtZmN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3MzM4MTIsImV4cCI6MjA3NTMwOTgxMn0.6DfWyqnCv8BGB-0VEdd2ENWB2rgu56GhbwjYiz_Wav8';

console.log('🔧 Initializing Supabase with URL:', SUPABASE_URL);

// Use the standard AsyncStorage for session persistence
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: AsyncStorage, // Use AsyncStorage from the imported package
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
    },
});