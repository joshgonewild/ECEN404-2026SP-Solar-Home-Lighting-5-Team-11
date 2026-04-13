// components/PiSetupFlow.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, Alert } from 'react-native';
import * as Network from 'expo-network';
import { supabase } from '../lib/supabase';

export const PiSetupFlow = ({ userId, onSetupComplete }) => {
    const [ssid, setSSID] = useState('');
    const [password, setPassword] = useState('');
    const [deviceName, setDeviceName] = useState('');
    const [loading, setLoading] = useState(false);
    const [piConnected, setPiConnected] = useState(false);

    useEffect(() => {
        checkPiConnection();
    }, []);

    const checkPiConnection = async () => {
        const network = await Network.getNetworkStateAsync();
        // Check if connected to Pi hotspot
        const isConnected = network.ssid?.includes('Solaris') || false;
        setPiConnected(isConnected);
    };

    const handleSetup = async () => {
        if (!piConnected) {
            Alert.alert('Not Connected', 'Please connect to a SOLARIS device first');
            return;
        }
        if (!ssid || !password || !deviceName) {
            Alert.alert('Missing Info', 'Please fill in all fields');
            return;
        }

        setLoading(true);
        try {
            // Send credentials AND user ID to Pi
            const response = await fetch('http://192.168.4.1:5000/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,           // Send user ID
                    device_name: deviceName,   // ← NEW: Let user name device
                    ssid: ssid,                // Send network name
                    password: password,        // Send network password
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                Alert.alert('Setup Failed', data.error || 'Unknown error');
                return;
            }

            // Pi returns the deviceId it created
            const { device_id, pi_id } = data;

            // Optional: Verify in your database
            await supabase
                .from('devices')
                .insert({
                    id: device_id,
                    user_id: userId,
                    pi_id: pi_id,
                    name: deviceName,
                });

            Alert.alert('Success', 'Device setup complete!');
            onSetupComplete(device_id);

        } catch (error) {
            Alert.alert('Error', error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={{ padding: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 10 }}>
                Setup Your Solar Device
            </Text>

            <Text style={{ color: piConnected ? 'green' : 'red', marginBottom: 20 }}>
                {piConnected ? 'Connected to Pi' : 'Connect to Pi hotspot first'}
            </Text>

            <TextInput
                placeholder="Device Name"
                placeholderTextColor='#999'
                value={deviceName}
                onChangeText={setDeviceName}
                style={{ borderWidth: 1, padding: 10, marginBottom: 10, borderRadius: 5 }}
            />

            <TextInput
                placeholder="Home WiFi SSID"
                placeholderTextColor='#999'
                value={ssid}
                onChangeText={setSSID}
                style={{ borderWidth: 1, padding: 10, marginBottom: 10, borderRadius: 5 }}
            />

            <TextInput
                placeholder="WiFi Password"
                placeholderTextColor={'#999'}
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                secureTextEntry
                style={{ borderWidth: 1, padding: 10, marginBottom: 15, borderRadius: 5, color: '#333' }}
            />

            <Button
                title={loading ? 'Setting up...' : 'Complete Setup'}
                onPress={handleSetup}
                disabled={!piConnected || loading}
            />
        </View>
    );
};