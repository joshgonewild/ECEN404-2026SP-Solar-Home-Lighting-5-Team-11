import { Stack } from 'expo-router';
import React from 'react';

// This is the layout for the auth screens
export default function AuthLayout() {
    return (
        <Stack>
            {/* The auth screen will have no header */}
            <Stack.Screen name="index" options={{ headerShown: false }} />
        </Stack>
    );
}