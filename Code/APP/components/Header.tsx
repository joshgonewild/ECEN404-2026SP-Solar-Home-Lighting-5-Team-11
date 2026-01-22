// components/Header.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
// Using a built-in icon for simplicity, e.g., from expo-symbols or vector-icons
// For this example, I'll use a simple text-based button.
// If you have @expo/vector-icons installed:
// import { Ionicons } from '@expo/vector-icons';

interface HeaderProps {
    userName: string;
    onProfilePress?: () => void;
}

export default function Header({ userName, onProfilePress }: HeaderProps) {
    return (
        <View style={styles.container}>
            <View>
                <Text style={styles.greeting}>Hi, {userName}</Text>
                <Text style={styles.title}>Dashboard</Text>
            </View>

            <View style={styles.rightContainer}>
                {/* Profile/User Button */}
                <TouchableOpacity
                    style={styles.profileButton}
                    onPress={onProfilePress}
                >
                    <Image
                        source={require('../assets/images/profile-placeholder.png')}
                        style={styles.profileImage}
                    />
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    greeting: {
        fontSize: 16,
        color: '#666',
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#000',
    },
    profileButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#E0E0E0',
    },
    profileImage: {
        width: '100%',
        height: '100%',
    },
});