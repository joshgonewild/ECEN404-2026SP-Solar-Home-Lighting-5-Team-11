// lib/types.ts

// lib/types.ts - ADD THIS INTERFACE
export interface SystemStatus {
    connected: boolean;
    foyerLight: boolean;
    porchLight: boolean;
    lastActivated: string;
    battery: number;
}

export interface Capture {
    id: string;
    file_name: string;
    file_path: string;
    file_size: number;
    duration: number;
    detected_at: string;
    timestamp: string;
    location?: string;
    thumbnail_data?: string;
    viewed: boolean;
    starred: boolean;
}

export type OperationMode = 'automatic' | 'manual' | 'scheduled';

export interface StatusRow {
    id: number;
    user_id?: string;
    connection: boolean;
    foyer: boolean;
    porch: boolean;
    mode_of_operation: string;
    battery_percentage: number;
    last_activation: string;
    created_at: string;
    updated_at: string;
}

export interface Light {
    id: string;
    name: string;
    status: 'ON' | 'OFF';
    location: 'indoor' | 'outdoor';
    updated_at: string;
}

export interface User {
    id: string;
    email: string;
    created_at: string;
}

// Supabase database types (optional but helpful)
export interface Database {
    public: {
        Tables: {
            lights: {
                Row: Light;
                Insert: Omit<Light, 'id' | 'updated_at'>;
                Update: Partial<Omit<Light, 'id'>>;
            };
            system_status: {
                Row: {
                    id: string;
                    battery_percentage: number;
                    operation_mode: OperationMode;
                    is_connected: boolean;
                    foyer_light: boolean;
                    porch_light: boolean;
                    last_activated: string;
                    last_heartbeat: string;
                };
                Insert: Omit<Database['public']['Tables']['system_status']['Row'], 'id'>;
                Update: Partial<Omit<Database['public']['Tables']['system_status']['Row'], 'id'>>;
            };
            motion_events: {
                Row: {
                    id: string;
                    user_id: string;
                    video_url: string;
                    thumbnail_url: string;
                    detected_at: string;
                    duration: number;
                    location: string;
                };
                Insert: Omit<Database['public']['Tables']['motion_events']['Row'], 'id'>;
                Update: Partial<Omit<Database['public']['Tables']['motion_events']['Row'], 'id'>>;
            };
        };
    };
}