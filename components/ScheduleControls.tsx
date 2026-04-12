// components/ScheduleControls.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    ScrollView,
    Alert,
    ActivityIndicator,
    TextInput,
    Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { supabase } from '../lib/supabase';
import { useAuth } from '../_context/AuthContext';

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
type Day = (typeof ALL_DAYS)[number];

// Maps display label → Postgres _text value stored in days_of_week
const DAY_VALUES: Record<Day, string> = {
    Mon: 'monday',
    Tue: 'tuesday',
    Wed: 'wednesday',
    Thu: 'thursday',
    Fri: 'friday',
    Sat: 'saturday',
    Sun: 'sunday',
};

interface Schedule {
    id: string;
    user_id: string;
    name: string;
    start_time: string; // "HH:MM:SS"
    end_time: string;   // "HH:MM:SS"
    days_of_week: string[]; // e.g. ["monday", "wednesday"]
    pi_id: string | null;
    created_at: string;
    updated_at: string;
}

interface ScheduleControlsProps {
    /** Optional: restrict to a specific device's pi_id */
    piId?: string;
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

/** Parse "HH:MM:SS" → Date (today at that time) */
const timeStringToDate = (t: string): Date => {
    const [h, m, s] = t.split(':').map(Number);
    const d = new Date();
    d.setHours(h ?? 0, m ?? 0, s ?? 0, 0);
    return d;
};

/** Date → "HH:MM:SS" */
const dateToTimeString = (d: Date): string =>
    [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join(':');

/** "HH:MM:SS" → "h:MM AM/PM" */
const formatTimeDisplay = (t: string): string => {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
};

/** days_of_week string[] → readable label */
const formatDays = (days: string[]): string => {
    if (!days?.length) return 'No days';
    if (days.length === 7) return 'Every day';
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const weekend = ['saturday', 'sunday'];
    if (weekdays.every((d) => days.includes(d)) && days.length === 5) return 'Weekdays';
    if (weekend.every((d) => days.includes(d)) && days.length === 2) return 'Weekends';
    return days.map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ');
};

// ═══════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════

interface TimeSectionProps {
    label: string;
    value: Date;
    onChange: (date: Date) => void;
}

const TimeSection = ({ label, value, onChange }: TimeSectionProps) => {
    const [showPicker, setShowPicker] = useState(false);

    const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS === 'android') setShowPicker(false);
        if (selected) onChange(selected);
    };

    return (
        <View style={modalStyles.timeSection}>
            <Text style={modalStyles.fieldLabel}>{label}</Text>
            <TouchableOpacity style={modalStyles.timeButton} onPress={() => setShowPicker(true)}>
                <Text style={modalStyles.timeButtonText}>
                    {value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <Text style={modalStyles.timeButtonIcon}>⏱</Text>
            </TouchableOpacity>
            {(showPicker || Platform.OS === 'ios') && (
                <DateTimePicker
                    value={value}
                    mode="time"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleChange}
                    style={Platform.OS === 'ios' ? modalStyles.iosTimePicker : undefined}
                />
            )}
        </View>
    );
};

// ═══════════════════════════════════════════════════
// SCHEDULE EDIT / ADD MODAL
// ═══════════════════════════════════════════════════

interface ScheduleModalProps {
    visible: boolean;
    schedule: Schedule | null; // null = "add new"
    piId?: string;
    userId: string;
    onClose: () => void;
    onSaved: () => void;
}

const ScheduleModal = ({ visible, schedule, piId, userId, onClose, onSaved }: ScheduleModalProps) => {
    const isNew = !schedule;

    const [name, setName] = useState('');
    const [startDate, setStartDate] = useState(timeStringToDate('08:00:00'));
    const [endDate, setEndDate] = useState(timeStringToDate('22:00:00'));
    const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);

    // Populate form when a schedule is selected for editing
    useEffect(() => {
        if (schedule) {
            setName(schedule.name ?? '');
            setStartDate(timeStringToDate(schedule.start_time));
            setEndDate(timeStringToDate(schedule.end_time));
            setSelectedDays(new Set(schedule.days_of_week ?? []));
        } else {
            setName('');
            setStartDate(timeStringToDate('08:00:00'));
            setEndDate(timeStringToDate('22:00:00'));
            setSelectedDays(new Set());
        }
    }, [schedule, visible]);

    const toggleDay = (day: Day) => {
        const val = DAY_VALUES[day];
        setSelectedDays((prev) => {
            const next = new Set(prev);
            next.has(val) ? next.delete(val) : next.add(val);
            return next;
        });
    };

    const handleSave = async () => {
        if (!name.trim()) {
            Alert.alert('Validation', 'Please enter a schedule name.');
            return;
        }
        if (selectedDays.size === 0) {
            Alert.alert('Validation', 'Please select at least one day.');
            return;
        }

        setSaving(true);
        const payload = {
            user_id: userId,
            name: name.trim(),
            start_time: dateToTimeString(startDate),
            end_time: dateToTimeString(endDate),
            days_of_week: Array.from(selectedDays),
            pi_id: piId ?? null,
            updated_at: new Date().toISOString(),
        };

        try {
            if (isNew) {
                const { error } = await supabase.from('schedules').insert({
                    ...payload,
                    created_at: new Date().toISOString(),
                });
                if (error) throw error;
            } else {
                const { error } = await supabase
                    .from('schedules')
                    .update(payload)
                    .eq('id', schedule!.id);
                if (error) throw error;
            }
            onSaved();
            onClose();
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Failed to save schedule.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        if (!schedule) return;
        Alert.alert('Delete Schedule', `Delete "${schedule.name}"? This cannot be undone.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        const { error } = await supabase
                            .from('schedules')
                            .delete()
                            .eq('id', schedule.id);
                        if (error) throw error;
                        onSaved();
                        onClose();
                    } catch (err: any) {
                        Alert.alert('Error', err.message || 'Failed to delete schedule.');
                    }
                },
            },
        ]);
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={modalStyles.overlay}>
                <View style={modalStyles.sheet}>
                    {/* Handle bar */}
                    <View style={modalStyles.handle} />

                    {/* Header */}
                    <View style={modalStyles.header}>
                        <Text style={modalStyles.headerTitle}>
                            {isNew ? 'New Schedule' : 'Edit Schedule'}
                        </Text>
                        <TouchableOpacity onPress={onClose} style={modalStyles.closeBtn}>
                            <Text style={modalStyles.closeBtnText}>✕</Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView
                        contentContainerStyle={modalStyles.body}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Name */}
                        <Text style={modalStyles.fieldLabel}>Schedule Name</Text>
                        <TextInput
                            style={modalStyles.textInput}
                            value={name}
                            onChangeText={setName}
                            placeholder="e.g. Evening Lights"
                            placeholderTextColor="#AAA"
                            returnKeyType="done"
                        />

                        {/* Days of Week */}
                        <Text style={[modalStyles.fieldLabel, { marginTop: 20 }]}>Days of Week</Text>
                        <View style={modalStyles.daysRow}>
                            {ALL_DAYS.map((day) => {
                                const active = selectedDays.has(DAY_VALUES[day]);
                                return (
                                    <TouchableOpacity
                                        key={day}
                                        style={[modalStyles.dayChip, active && modalStyles.dayChipActive]}
                                        onPress={() => toggleDay(day)}
                                        activeOpacity={0.7}
                                    >
                                        <Text
                                            style={[
                                                modalStyles.dayChipText,
                                                active && modalStyles.dayChipTextActive,
                                            ]}
                                        >
                                            {day}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* Time pickers */}
                        <View style={modalStyles.timesRow}>
                            <View style={{ flex: 1, marginRight: 8 }}>
                                <TimeSection
                                    label="Start Time"
                                    value={startDate}
                                    onChange={setStartDate}
                                />
                            </View>
                            <View style={{ flex: 1, marginLeft: 8 }}>
                                <TimeSection
                                    label="End Time"
                                    value={endDate}
                                    onChange={setEndDate}
                                />
                            </View>
                        </View>

                        {/* Save */}
                        <TouchableOpacity
                            style={[modalStyles.saveBtn, saving && { opacity: 0.6 }]}
                            onPress={handleSave}
                            disabled={saving}
                        >
                            {saving ? (
                                <ActivityIndicator color="#FFF" />
                            ) : (
                                <Text style={modalStyles.saveBtnText}>
                                    {isNew ? 'Create Schedule' : 'Save Changes'}
                                </Text>
                            )}
                        </TouchableOpacity>

                        {/* Delete (edit mode only) */}
                        {!isNew && (
                            <TouchableOpacity style={modalStyles.deleteBtn} onPress={handleDelete}>
                                <Text style={modalStyles.deleteBtnText}>Delete Schedule</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════

export default function ScheduleControls({ piId }: ScheduleControlsProps) {
    const { session } = useAuth();
    const userId = session?.user?.id ?? '';

    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);

    const loadSchedules = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            let query = supabase
                .from('schedules')
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: true });

            if (piId) query = query.eq('pi_id', piId);

            const { data, error } = await query;
            if (error) throw error;
            setSchedules((data as Schedule[]) ?? []);
        } catch (err: any) {
            console.error('Error loading schedules:', err);
        } finally {
            setLoading(false);
        }
    }, [userId, piId]);

    useEffect(() => {
        loadSchedules();
    }, [loadSchedules]);

    const openAdd = () => {
        setSelectedSchedule(null);
        setModalVisible(true);
    };

    const openEdit = (schedule: Schedule) => {
        setSelectedSchedule(schedule);
        setModalVisible(true);
    };

    return (
        <View style={styles.container}>
            {/* Section header */}
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Schedules</Text>
                <TouchableOpacity style={styles.addButton} onPress={openAdd} activeOpacity={0.8}>
                    <Text style={styles.addButtonText}>+ Add New</Text>
                </TouchableOpacity>
            </View>

            {/* List */}
            {loading ? (
                <ActivityIndicator color="#007AFF" style={{ marginTop: 16 }} />
            ) : schedules.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyStateIcon}>🕐</Text>
                    <Text style={styles.emptyStateText}>No schedules yet</Text>
                    <Text style={styles.emptyStateSubtext}>
                        Tap "+ Add New" to create your first schedule.
                    </Text>
                </View>
            ) : (
                schedules.map((s) => (
                    <TouchableOpacity
                        key={s.id}
                        style={styles.scheduleCard}
                        onPress={() => openEdit(s)}
                        activeOpacity={0.85}
                    >
                        {/* Left accent stripe */}
                        <View style={styles.cardAccent} />

                        <View style={styles.cardContent}>
                            <Text style={styles.cardName} numberOfLines={1}>
                                {s.name}
                            </Text>
                            <Text style={styles.cardTimes}>
                                {formatTimeDisplay(s.start_time)} → {formatTimeDisplay(s.end_time)}
                            </Text>
                            <Text style={styles.cardDays}>{formatDays(s.days_of_week)}</Text>
                        </View>

                        <Text style={styles.cardChevron}>›</Text>
                    </TouchableOpacity>
                ))
            )}

            {/* Modal */}
            <ScheduleModal
                visible={modalVisible}
                schedule={selectedSchedule}
                piId={piId}
                userId={userId}
                onClose={() => setModalVisible(false)}
                onSaved={loadSchedules}
            />
        </View>
    );
}

// ═══════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════

const styles = StyleSheet.create({
    container: {
        marginTop: 8,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111',
    },
    addButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
    },
    addButtonText: {
        color: '#FFF',
        fontSize: 13,
        fontWeight: '600',
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 32,
        backgroundColor: '#FFF',
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 2,
    },
    emptyStateIcon: {
        fontSize: 36,
        marginBottom: 8,
    },
    emptyStateText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 4,
    },
    emptyStateSubtext: {
        fontSize: 13,
        color: '#999',
        textAlign: 'center',
        paddingHorizontal: 32,
    },
    scheduleCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#007AFF',
        borderRadius: 14,
        marginBottom: 10,
        overflow: 'hidden',
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
        elevation: 4,
    },
    cardAccent: {
        width: 5,
        alignSelf: 'stretch',
        backgroundColor: 'rgba(255,255,255,0.35)',
    },
    cardContent: {
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 14,
    },
    cardName: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFF',
        marginBottom: 3,
    },
    cardTimes: {
        fontSize: 13,
        color: 'rgba(255,255,255,0.85)',
        marginBottom: 2,
    },
    cardDays: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.7)',
        fontWeight: '500',
    },
    cardChevron: {
        fontSize: 24,
        color: 'rgba(255,255,255,0.6)',
        paddingRight: 14,
        fontWeight: '300',
    },
});

const modalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#F5F5F5',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingBottom: 40,
        maxHeight: '90%',
    },
    handle: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#CCC',
        alignSelf: 'center',
        marginTop: 12,
        marginBottom: 4,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#E8E8E8',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111',
    },
    closeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#E8E8E8',
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeBtnText: {
        fontSize: 14,
        color: '#555',
        fontWeight: '600',
    },
    body: {
        padding: 20,
        paddingBottom: 8,
    },
    fieldLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#555',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    textInput: {
        backgroundColor: '#FFF',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 13,
        fontSize: 16,
        color: '#111',
        borderWidth: 1.5,
        borderColor: '#E0E0E0',
    },
    daysRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 8,
    },
    dayChip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: '#FFF',
        borderWidth: 1.5,
        borderColor: '#E0E0E0',
    },
    dayChipActive: {
        backgroundColor: '#007AFF',
        borderColor: '#007AFF',
    },
    dayChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#555',
    },
    dayChipTextActive: {
        color: '#FFF',
    },
    timesRow: {
        flexDirection: 'row',
        marginTop: 20,
        marginBottom: 8,
    },
    timeSection: {
        flex: 1,
    },
    timeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFF',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderWidth: 1.5,
        borderColor: '#E0E0E0',
    },
    timeButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#007AFF',
    },
    timeButtonIcon: {
        fontSize: 16,
    },
    iosTimePicker: {
        height: 120,
        marginTop: 4,
    },
    saveBtn: {
        backgroundColor: '#007AFF',
        borderRadius: 14,
        paddingVertical: 15,
        alignItems: 'center',
        marginTop: 28,
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    saveBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: '700',
    },
    deleteBtn: {
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 12,
        borderWidth: 1.5,
        borderColor: '#FF3B30',
    },
    deleteBtnText: {
        color: '#FF3B30',
        fontSize: 15,
        fontWeight: '600',
    },
});
