import { Stack } from 'expo-router';
import React from 'react';

// This is the layout for the main app screens
export default function AppLayout() {
    return (
        <Stack>
            {/* The dashboard screen will have no header, as it has its own */}
            <Stack.Screen name="dashboard" options={{ headerShown: false }} />
            <Stack.Screen name="metrics" options={{ title: 'Metrics' }} />
            {/* Add other app screens here, e.g., settings, profile, etc. */}
            {/* <Stack.Screen name="settings" options={{ title: 'Settings' }} /> */}
        </Stack>
    );
}