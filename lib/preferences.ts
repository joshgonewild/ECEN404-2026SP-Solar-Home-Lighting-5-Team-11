// lib/preferences.ts
import { supabase } from './supabase';

export interface UserPreferences {
    light_on_duration: number;
    video_clip_duration: number;
}

const DEFAULTS: UserPreferences = {
    light_on_duration: 30,
    video_clip_duration: 15,
};

export async function getPreferences(userId: string): Promise<UserPreferences> {
    const { data, error } = await supabase
        .from('user_preferences')
        .select('light_on_duration, video_clip_duration')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) console.error('Error fetching preferences:', error);

    // If no row yet, create one with defaults
    if (!data) {
        await supabase.from('user_preferences').insert({ user_id: userId, ...DEFAULTS });
        return DEFAULTS;
    }

    return data as UserPreferences;
}

export async function updatePreferences(userId: string, updates: Partial<UserPreferences>) {
    const { error } = await supabase
        .from('user_preferences')
        .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' });

    if (error) console.error('Error updating preferences:', error);
    return !error;
}