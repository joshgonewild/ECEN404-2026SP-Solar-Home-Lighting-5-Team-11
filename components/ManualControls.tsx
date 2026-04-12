// components/ManualControls.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export default function ManualControls({ foyerLight, porchLight, onToggleLight }) {
    return (
        <View style={styles.container}>
            <TouchableOpacity
                style={[
                    styles.lightButton,
                    foyerLight ? styles.lightOn : styles.lightOff
                ]}
                onPress={() => onToggleLight('foyer', !foyerLight)}
            >
                <Text style={styles.lightName}>Foyer Light</Text>
                <Text style={styles.lightStatus}>{foyerLight ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[
                    styles.lightButton,
                    porchLight ? styles.lightOn : styles.lightOff
                ]}
                onPress={() => onToggleLight('porch', !porchLight)}
            >
                <Text style={styles.lightName}>Porch Light</Text>
                <Text style={styles.lightStatus}>{porchLight ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    lightButton: {
        flex: 1,
        aspectRatio: 1,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginHorizontal: 8,
    },
    lightOff: {
        backgroundColor: '#9E9E9E',
    },
    lightOn: {
        backgroundColor: '#FFEB3B',
    },
    lightName: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#000',
        marginBottom: 8,
    },
    lightStatus: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000',
    },
});