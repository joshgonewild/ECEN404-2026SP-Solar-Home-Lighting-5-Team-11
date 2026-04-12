// app/(app)/settings.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Switch,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../_context/AuthContext';

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

interface UserPreferences {
    light_on_duration: number;       // seconds (5–45)
    video_clip_duration: number;     // seconds (5–45)
    motion_sensitivity: number;      // 1–10
    auto_delete_after_days: number;  // days (0–90), 0 = never
    notifications_enabled: boolean;
    night_mode_enabled: boolean;
}

const DEFAULTS: UserPreferences = {
    light_on_duration: 30,
    video_clip_duration: 15,
    motion_sensitivity: 5,
    auto_delete_after_days: 30,
    notifications_enabled: true,
    night_mode_enabled: false,
};

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

const formatSeconds = (s: number) =>
    s >= 60 ? `${Math.floor(s / 60)}m ${s % 60 > 0 ? `${s % 60}s` : ''}`.trim() : `${s}s`;

const formatDays = (d: number) => (d === 0 ? 'Never' : d === 1 ? '1 day' : `${d} days`);

// ═══════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════

const SectionHeader = ({ title }: { title: string }) => (
    <Text style={styles.sectionHeader}>{title}</Text>
);

const SettingRow = ({ label, sublabel, children }: {
    label: string;
    sublabel?: string;
    children: React.ReactNode;
}) => (
    <View style={styles.settingRow}>
        <View style={styles.settingLabelContainer}>
            <Text style={styles.settingLabel}>{label}</Text>
            {sublabel ? <Text style={styles.settingSubLabel}>{sublabel}</Text> : null}
        </View>
        <View style={styles.settingControl}>{children}</View>
    </View>
);

const SliderRow = ({
                       label,
                       sublabel,
                       value,
                       min,
                       max,
                       step,
                       unit,
                       displayValue,
                       onValueChange,
                       onSlidingComplete,
                   }: {
    label: string;
    sublabel?: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: 's' | 'd' | '';   // 's' = seconds, 'd' = days, '' = unitless
    displayValue: string;
    onValueChange: (v: number) => void;
    onSlidingComplete: (v: number) => void;
}) => {
    // For day sliders that start at 0, the min bound means "Never"
    const minLabel = unit === 'd' && min === 0 ? 'Never' : `${min}${unit}`;
    const maxLabel = `${max}${unit}`;

    return (
        <View style={styles.sliderRow}>
            <View style={styles.sliderRowHeader}>
                <View>
                    <Text style={styles.settingLabel}>{label}</Text>
                    {sublabel ? <Text style={styles.settingSubLabel}>{sublabel}</Text> : null}
                </View>
                <View style={styles.sliderValueBadge}>
                    <Text style={styles.sliderValueText}>{displayValue}</Text>
                </View>
            </View>
            <Slider
                style={styles.slider}
                value={value}
                minimumValue={min}
                maximumValue={max}
                step={step}
                minimumTrackTintColor="#007AFF"
                maximumTrackTintColor="#E0E0E0"
                thumbTintColor="#007AFF"
                onValueChange={onValueChange}
                onSlidingComplete={onSlidingComplete}
            />
            <View style={styles.sliderBounds}>
                <Text style={styles.sliderBoundText}>{minLabel}</Text>
                <Text style={styles.sliderBoundText}>{maxLabel}</Text>
            </View>
        </View>
    );
};

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════

export default function SettingsScreen() {
    const { session, signOut } = useAuth();
    const userId = session?.user?.id ?? '';

    const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // ─────────────────────────────────────────────────
    // DATA
    // ─────────────────────────────────────────────────

    const loadPreferences = useCallback(async () => {
        if (!userId) return;
        try {
            const { data, error } = await supabase
                .from('user_preferences')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            if (error) throw error;

            if (!data) {
                await supabase.from('user_preferences').insert({ user_id: userId, ...DEFAULTS });
                setPrefs(DEFAULTS);
            } else {
                setPrefs({ ...DEFAULTS, ...data });
            }
        } catch (e) {
            console.error('Error loading preferences:', e);
            Alert.alert('Error', 'Could not load your preferences.');
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        loadPreferences();
    }, [loadPreferences]);

    const savePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
        if (!userId) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from('user_preferences')
                .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' });

            if (error) throw error;
        } catch (e) {
            console.error('Error saving preferences:', e);
            Alert.alert('Error', 'Could not save your preferences.');
        } finally {
            setSaving(false);
        }
    }, [userId]);

    // ─────────────────────────────────────────────────
    // HANDLERS
    // ─────────────────────────────────────────────────

    const handleSliderChange = (key: keyof UserPreferences) => (value: number) => {
        setPrefs((prev) => ({ ...prev, [key]: value }));
    };

    const handleSliderComplete = (key: keyof UserPreferences) => (value: number) => {
        setPrefs((prev) => ({ ...prev, [key]: value }));
        savePreferences({ [key]: value });
    };

    const handleToggle = (key: keyof UserPreferences) => (value: boolean) => {
        const updated = { ...prefs, [key]: value };
        setPrefs(updated);
        savePreferences({ [key]: value });
    };

    const handleSignOut = () => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
        ]);
    };

    const handleResetDefaults = () => {
        Alert.alert(
            'Reset to Defaults',
            'This will restore all settings to their original values.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Reset',
                    style: 'destructive',
                    onPress: () => {
                        setPrefs(DEFAULTS);
                        savePreferences(DEFAULTS);
                    },
                },
            ]
        );
    };

    // ─────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <Text style={styles.loadingText}>Loading Settings...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <StatusBar barStyle="dark-content" />

            <View style={styles.header}>
                <Text style={styles.headerTitle}>Settings</Text>
                {saving && <ActivityIndicator size="small" color="#007AFF" />}
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Account */}
                <SectionHeader title="ACCOUNT" />
                <View style={styles.card}>
                    <SettingRow label="Email" sublabel={session?.user?.email ?? '—'}>
                        <View />
                    </SettingRow>
                </View>

                {/* Lighting */}
                <SectionHeader title="LIGHTING" />
                <View style={styles.card}>
                    <SliderRow
                        label="Light On Duration"
                        sublabel="How long lights stay on after a trigger"
                        value={prefs.light_on_duration}
                        min={5}
                        max={45}
                        step={5}
                        unit="s"
                        displayValue={formatSeconds(prefs.light_on_duration)}
                        onValueChange={handleSliderChange('light_on_duration')}
                        onSlidingComplete={handleSliderComplete('light_on_duration')}
                    />
                </View>

                {/* Camera */}
                <SectionHeader title="CAMERA" />
                <View style={styles.card}>
                    <SliderRow
                        label="Video Clip Duration"
                        sublabel="Length of each recorded clip"
                        value={prefs.video_clip_duration}
                        min={5}
                        max={45}
                        step={5}
                        unit="s"
                        displayValue={formatSeconds(prefs.video_clip_duration)}
                        onValueChange={handleSliderChange('video_clip_duration')}
                        onSlidingComplete={handleSliderComplete('video_clip_duration')}
                    />

                    <View style={styles.divider} />

                    <SliderRow
                        label="Motion Sensitivity"
                        sublabel="Higher = detects more movement"
                        value={prefs.motion_sensitivity}
                        min={1}
                        max={10}
                        step={1}
                        unit=""
                        displayValue={`${prefs.motion_sensitivity} / 10`}
                        onValueChange={handleSliderChange('motion_sensitivity')}
                        onSlidingComplete={handleSliderComplete('motion_sensitivity')}
                    />

                    <View style={styles.divider} />

                    <SliderRow
                        label="Auto-Delete Clips After"
                        sublabel="Automatically remove old recordings"
                        value={prefs.auto_delete_after_days}
                        min={0}
                        max={90}
                        step={1}
                        unit="d"
                        displayValue={formatDays(prefs.auto_delete_after_days)}
                        onValueChange={handleSliderChange('auto_delete_after_days')}
                        onSlidingComplete={handleSliderComplete('auto_delete_after_days')}
                    />
                </View>

                {/* Notifications */}
                <SectionHeader title="NOTIFICATIONS" />
                <View style={styles.card}>
                    <SettingRow
                        label="Push Notifications"
                        sublabel="Get alerted when motion is detected"
                    >
                        <Switch
                            value={prefs.notifications_enabled}
                            onValueChange={handleToggle('notifications_enabled')}
                            trackColor={{ false: '#E0E0E0', true: '#007AFF' }}
                            thumbColor="#FFF"
                        />
                    </SettingRow>

                    <View style={styles.divider} />

                    <SettingRow
                        label="Night Mode"
                        sublabel="Reduce sensitivity during nighttime hours"
                    >
                        <Switch
                            value={prefs.night_mode_enabled}
                            onValueChange={handleToggle('night_mode_enabled')}
                            trackColor={{ false: '#E0E0E0', true: '#007AFF' }}
                            thumbColor="#FFF"
                        />
                    </SettingRow>
                </View>

                {/* System */}
                <SectionHeader title="SYSTEM" />
                <View style={styles.card}>
                    <TouchableOpacity style={styles.actionRow} onPress={handleResetDefaults}>
                        <Text style={styles.actionText}>Reset to Defaults</Text>
                    </TouchableOpacity>
                </View>

                <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
                    <Text style={styles.signOutText}>Sign Out</Text>
                </TouchableOpacity>

                <Text style={styles.versionText}>SOLARIS v1.0.0</Text>
            </ScrollView>
        </SafeAreaView>
    );
}

// ═══════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#666',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: '#F5F5F5',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '700',
        color: '#000',
        letterSpacing: -0.5,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingBottom: 40,
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '600',
        color: '#999',
        letterSpacing: 0.8,
        marginTop: 24,
        marginBottom: 8,
        marginLeft: 4,
    },
    card: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingHorizontal: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
        elevation: 2,
    },
    divider: {
        height: 1,
        backgroundColor: '#F0F0F0',
        marginHorizontal: -4,
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        minHeight: 56,
    },
    settingLabelContainer: {
        flex: 1,
        paddingRight: 12,
    },
    settingLabel: {
        fontSize: 15,
        fontWeight: '500',
        color: '#1A1A1A',
    },
    settingSubLabel: {
        fontSize: 12,
        color: '#999',
        marginTop: 2,
    },
    settingControl: {
        alignItems: 'flex-end',
    },
    sliderRow: {
        paddingVertical: 14,
    },
    sliderRowHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    sliderValueBadge: {
        backgroundColor: '#EEF4FF',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    sliderValueText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#007AFF',
    },
    slider: {
        width: '100%',
        height: 32,
    },
    sliderBounds: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: -4,
    },
    sliderBoundText: {
        fontSize: 11,
        color: '#CCC',
    },
    actionRow: {
        paddingVertical: 16,
    },
    actionText: {
        fontSize: 15,
        fontWeight: '500',
        color: '#FF3B30',
    },
    signOutButton: {
        marginTop: 24,
        backgroundColor: '#FFF',
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07,
        shadowRadius: 6,
        elevation: 2,
    },
    signOutText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#FF3B30',
    },
    versionText: {
        textAlign: 'center',
        marginTop: 24,
        fontSize: 12,
        color: '#CCC',
        letterSpacing: 1,
    },
});
