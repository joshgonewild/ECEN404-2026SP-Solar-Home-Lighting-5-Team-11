// components/ScheduleControls.js
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function ScheduleControls() {
    const [startTime, setStartTime] = useState(new Date());
    const [endTime, setEndTime] = useState(new Date());
    const [showStartPicker, setShowStartPicker] = useState(false);
    const [showEndPicker, setShowEndPicker] = useState(false);

    const formatTime = (date) => {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Set Schedule</Text>

            <View style={styles.scheduleCard}>
                <View style={styles.timeRow}>
                    <Text style={styles.label}>Start Time</Text>
                    <TouchableOpacity
                        style={styles.timeButton}
                        onPress={() => setShowStartPicker(true)}
                    >
                        <Text style={styles.timeText}>{formatTime(startTime)}</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.timeRow}>
                    <Text style={styles.label}>End Time</Text>
                    <TouchableOpacity
                        style={styles.timeButton}
                        onPress={() => setShowEndPicker(true)}
                    >
                        <Text style={styles.timeText}>{formatTime(endTime)}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {showStartPicker && (
                <DateTimePicker
                    value={startTime}
                    mode="time"
                    display="default"
                    onChange={(event, selectedDate) => {
                        setShowStartPicker(false);
                        if (selectedDate) setStartTime(selectedDate);
                    }}
                />
            )}

            {showEndPicker && (
                <DateTimePicker
                    value={endTime}
                    mode="time"
                    display="default"
                    onChange={(event, selectedDate) => {
                        setShowEndPicker(false);
                        if (selectedDate) setEndTime(selectedDate);
                    }}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 12,
        color: '#000',
    },
    scheduleCard: {
        backgroundColor: '#D9D9D9',
        borderRadius: 12,
        padding: 16,
    },
    timeRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000',
    },
    timeButton: {
        backgroundColor: '#FFF',
        borderRadius: 20,
        paddingVertical: 8,
        paddingHorizontal: 20,
    },
    timeText: {
        fontSize: 16,
        color: '#000',
    },
});