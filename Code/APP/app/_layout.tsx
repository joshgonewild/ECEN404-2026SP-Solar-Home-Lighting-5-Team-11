import 'react-native-url-polyfill/auto';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/_context/AuthContext';
import React from 'react';

export default function RootLayout() {
    return (
        // Wrap the entire app in the AuthProvider
        <AuthProvider>
            <SafeAreaProvider>
                {/* Slot will render the current active route */}
                <Slot />
            </SafeAreaProvider>
        </AuthProvider>
    );
}