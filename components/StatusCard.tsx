// components/StatusCard.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import CircularProgress from './CircularProgress';

export default function StatusCard({ status }) {
    const { connected, foyerLight, porchLight, lastActivated, battery } = status;

    return (
        <View style={styles.container}>
            <View style={styles.textSection}>
                <Text style={styles.text}>
                    Status: {connected ? 'Connected' : 'Disconnected'}
                </Text>
                <Text style={styles.text}>
                    Foyer Light: {foyerLight ? 'ON' : 'OFF'}
                </Text>
                <Text style={styles.text}>
                    Porch Light: {porchLight ? 'ON' : 'OFF'}
                </Text>
                <Text style={styles.text}>
                    Last Activated: {lastActivated}
                </Text>
            </View>

            <View style={styles.batterySection}>
                <Text style={styles.batteryLabel}>Battery</Text>
                <CircularProgress percentage={battery} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: '#D9D9D9',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    textSection: {
        flex: 1,
        justifyContent: 'space-around',
    },
    text: {
        fontSize: 14,
        color: '#000',
        marginBottom: 4,
    },
    batterySection: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    batteryLabel: {
        fontSize: 12,
        marginBottom: 8,
        color: '#000',
    },
});