// lib/piServer.ts - UPDATED for new device-centric logic
// NOTE: We no longer import supabase here, as this file is just for Pi HTTP calls.

// This is now a DUMMY URL. The real one will be loaded from the 'devices' table.
import {Alert} from "react-native";

export const PI_SERVER_URL_PLACEHOLDER = 'https://demo-device-001.solaris-lights.online';

/**
 * Get the full streaming URL for a video file
 * @param piUrl - The Pi's actual Cloudflare URL
 * @param filename - The video filename (e.g., "2024-01-15_14-30-00.mp4")
 * @returns Full URL to stream the video
 */
export const getVideoStreamUrl = (piUrl: string | undefined, filename: string): string => {
    if (!filename || !piUrl) {
        console.warn('getVideoStreamUrl called with empty URL or filename');
        return '';
    }
    return `${piUrl}/videos/${filename}`;
};

/**
 * Check if the Pi server is reachable
 * @param piUrl - The Pi's actual Cloudflare URL
 * @returns Promise<boolean> - true if server responds, false otherwise
 */
export const checkPiConnection = async (piUrl: string | undefined): Promise<boolean> => {
    if (!piUrl) {
        return false;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${piUrl}/health`, {
            method: 'GET',
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            console.log('✅ Pi server is online');
            return true;
        }

        console.warn('⚠️ Pi server responded but not OK:', response.status);
        return false;
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.error('❌ Pi connection timeout (5s)');
        } else {
            console.error('❌ Pi connection failed:', error.message);
        }
        return false;
    }
};

/**
 * Send a command to the Pi to toggle a light
 * @param piUrl - The Pi's actual Cloudflare URL
 * @param light - Which light to toggle
 * @param value - The new state (true for ON, false for OFF)
 * @returns Promise<boolean> - true if successful
 */
export const sendLightToggle = async (
    piUrl: string | undefined,
    light: 'foyer' | 'porch',
    value: boolean
): Promise<boolean> => {
    if (!piUrl) {
        Alert.alert('Error', 'Device URL not found.');
        return false;
    }
    try {
        const response = await fetch(`${piUrl}/control`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ light, value }),
        });

        if (response.ok) {
            console.log(`✅ ${light} light set to:`, value);
            return true;
        } else {
            console.error('Error toggling light (server error):', response.status);
            return false;
        }
    } catch (error: any) {
        console.error('Error toggling light (network error):', error.message);
        return false;
    }
};

// 🛑 The syncVideosToDatabase function is no longer needed here.
// The Pi hardware is now responsible for inserting its own motion events.