// app/(app)/dashboard.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    StatusBar,
    RefreshControl,
    Alert,
    AppState,
    AppStateStatus,
    TouchableOpacity,
    Modal,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet from '@gorhom/bottom-sheet';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import Svg, { Circle } from 'react-native-svg';
import { router } from 'expo-router';

// Import components
import Header from '../../components/Header';
import ModeSelector from '../../components/ModeSelector';
import StatusCard from '../../components/StatusCard';
import ManualControls from '../../components/ManualControls';
import ScheduleControls from '../../components/ScheduleControls';
import RecentCaptures from '../../components/RecentCaptures';
import { PiSetupFlow } from '../../components/PiSetupFlow';

// Import lib
import { supabase } from '../../lib/supabase';
import {
    checkPiConnection,
    getVideoStreamUrl,
    sendLightToggle,
    sendModeChange,
    getPiStatus,
} from '../../lib/piServer';
import { SystemStatus, Capture, OperationMode } from '../../lib/types';
import { useAuth } from '../../_context/AuthContext';

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

// FIX: Move SolarisDevice and PiVideo to lib/types.ts in a future pass.
interface SolarisDevice {
    id: string;
    user_id: string;
    name: string;
    pi_url: string;
}

// FIX: Moved out of loadCaptures; belongs in lib/types.ts long-term.
interface PiVideo {
    filename: string;
    modified: number; // unix seconds
    size: number;     // bytes
}

interface EventCounts {
    camera: number;
    indoor: number;
    outdoor: number;
    total: number;
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

// FIX: Moved to lib/piServer.ts long-term. Derives path from pi_url instead of hardcoding.
const getVideosEndpoint = (piUrl: string): string => `${piUrl.replace(/\/$/, '')}/videos`;

// ═══════════════════════════════════════════════════
// COMPONENTS FOR METRICS
// ═══════════════════════════════════════════════════

const EventDonut = ({ camera, indoor, outdoor, total, size = 120 }: EventCounts & { size?: number }) => {
    const radius = size * 0.35;
    const center = size / 2;
    const circ = 2 * Math.PI * radius;
    const safeTotal = total || 1;

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Circle
                cx={center} cy={center} r={radius} fill="none" stroke="#ef4444"
                strokeWidth="10" strokeDasharray={`${(camera / safeTotal) * circ} ${circ}`}
                rotation="-90" origin={`${center}, ${center}`} strokeLinecap="round"
            />
            <Circle
                cx={center} cy={center} r={radius} fill="none" stroke="#3b82f6"
                strokeWidth="10" strokeDasharray={`${(indoor / safeTotal) * circ} ${circ}`}
                rotation={-90 + (camera / safeTotal * 360)} origin={`${center}, ${center}`} strokeLinecap="round"
            />
            <Circle
                cx={center} cy={center} r={radius} fill="none" stroke="#22c55e"
                strokeWidth="10" strokeDasharray={`${(outdoor / safeTotal) * circ} ${circ}`}
                rotation={-90 + ((camera + indoor) / safeTotal * 360)} origin={`${center}, ${center}`} strokeLinecap="round"
            />
        </Svg>
    );
};

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function DashboardScreen() {
    const { session, signOut } = useAuth();

    const [currentDevice, setCurrentDevice] = useState<SolarisDevice | null>(null);
    const [mode, setMode] = useState<OperationMode>('automatic');
    const [systemStatus, setSystemStatus] = useState<SystemStatus>({
        connected: false,
        foyerLight: false,
        porchLight: false,
        lastActivated: 'Never',
        battery: 0,
    });
    const [captures, setCaptures] = useState<Capture[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [piConnected, setPiConnected] = useState(false);
    const [isActive, setIsActive] = useState(true);
    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
    const [showSetupFlow, setShowSetupFlow] = useState(false);
    const [eventCounts, setEventCounts] = useState<EventCounts>({ camera: 0, indoor: 0, outdoor: 0, total: 0 });

    const bottomSheetRef = useRef<BottomSheet>(null);
    const statusIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const captureIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─────────────────────────────────────────────────
    // DATA LOADING
    // ─────────────────────────────────────────────────

    const loadDevice = async (): Promise<SolarisDevice | null> => {
        const userId = session?.user?.id;
        if (!userId) return null;

        try {
            // FIX: Added user_id filter for defense-in-depth (don't rely solely on RLS).
            const { data, error } = await supabase
                .from('devices')
                .select('*')
                .eq('user_id', userId)
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('Error loading device:', error);
                return null;
            }

            if (!data) {
                setCurrentDevice(null);
                return null;
            }

            const device = data as SolarisDevice;
            setCurrentDevice(device);
            return device;
        } catch (err) {
            console.error('Exception loading device:', err);
            return null;
        }
    };

    // FIX: Accepts explicit piUrl arg; no fallback to stale closure over currentDevice.
    const loadSystemStatus = useCallback(async (piUrl: string) => {
        try {
            // FIX: Single call — checkPiConnection result drives both piConnected and the
            // early-return, eliminating the redundant checkPi() call from loadDeviceAndData.
            const isConnected = await checkPiConnection(piUrl);
            setPiConnected(isConnected);

            if (!isConnected) {
                setSystemStatus((prev) => ({ ...prev, connected: false }));
                return;
            }

            const s = await getPiStatus(piUrl);
            if (!s?.ok) return;

            setMode((s.mode as OperationMode) || 'automatic');
            setSystemStatus((prev) => ({
                ...prev,
                connected: true,
                foyerLight: !!s.lights?.foyer,
                porchLight: !!s.lights?.porch,
            }));
        } catch (error) {
            console.error('Error loading Pi system status:', error);
        }
    }, []); // No deps — piUrl is always passed explicitly.

    // FIX: Accepts explicit args; no stale closure over currentDevice.
    // FIX: Removed double @ts-ignore by typing the mapped result properly.
    const loadCaptures = useCallback(async (deviceId: string, piUrl: string) => {
        const videosEndpoint = getVideosEndpoint(piUrl);

        try {
            const res = await fetch(videosEndpoint, {
                method: 'GET',
                headers: { Accept: 'application/json' },
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

            const data = (await res.json()) as PiVideo[];

            const latest = [...data]
                .sort((a, b) => b.modified - a.modified)
                .slice(0, 20);

            const mapped: Capture[] = latest.map((v) => {
                const detectedDate = new Date(v.modified * 1000);
                const fileUrl = `${videosEndpoint}/${encodeURIComponent(v.filename)}`;
                return {
                    id: v.filename,
                    file_name: v.filename,
                    file_path: fileUrl,
                    file_size: v.size ?? 0,
                    duration: 0,
                    detected_at: detectedDate.toISOString(),
                    timestamp: detectedDate.toLocaleString(),
                    location: 'SOLARIS Camera',
                    thumbnail_data: undefined,
                    viewed: false,
                    starred: false,
                };
            });

            setCaptures(mapped);
        } catch (error) {
            console.error('Error loading captures from Pi server:', error);
        }
    }, []); // No deps — args always passed explicitly.

    // FIX: Accepts explicit deviceId; no stale closure.
    const loadMetricData = useCallback(async (deviceId: string) => {
        try {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const { data, error } = await supabase
                .from('trigger_events')
                .select('sensor_triggered')
                .eq('pi_id', deviceId)
                .gte('created_at', startOfDay.toISOString()); // 👈 add this

            if (error) throw error;

            const counts = {
                camera: data?.filter((e) => e.sensor_triggered === 'camera').length ?? 0,
                indoor: data?.filter((e) => e.sensor_triggered === 'indoor_pir').length ?? 0,
                outdoor: data?.filter((e) => e.sensor_triggered === 'outdoor_pir').length ?? 0,
            };
            setEventCounts({ ...counts, total: counts.camera + counts.indoor + counts.outdoor });
        } catch (e) {
            console.error('Error loading metrics:', e);
        }
    }, []); // No deps — deviceId always passed explicitly.

    // FIX: Passes explicit args to each loader; removed redundant checkPi call.
    const loadDeviceAndData = useCallback(async () => {
        setLoading(true);
        const device = await loadDevice();
        if (device) {
            await Promise.all([
                loadSystemStatus(device.pi_url),           // includes connectivity check
                loadCaptures(device.id, device.pi_url),
                loadMetricData(device.id),
            ]);
        }
        setLoading(false);
    }, [loadSystemStatus, loadCaptures, loadMetricData]);

    // ─────────────────────────────────────────────────
    // EFFECTS
    // ─────────────────────────────────────────────────

    useEffect(() => {
        loadDeviceAndData();
    }, []);

    // FIX: Polling effect — separated from data-load effect to avoid interval thrash.
    // Polling uses a stable ref-based callback to avoid re-creating intervals on every render.
    useEffect(() => {
        if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
        if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);

        if (isActive && currentDevice) {
            const { pi_url, id } = currentDevice;

            statusIntervalRef.current = setInterval(() => {
                loadSystemStatus(pi_url);
            }, 2000);

            captureIntervalRef.current = setInterval(() => {
                loadCaptures(id, pi_url);
            }, 30000);
        }

        const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
            setIsActive(state === 'active');
            if (state === 'active') loadDeviceAndData();
        });

        return () => {
            if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
            if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
            subscription.remove();
        };
    }, [isActive, currentDevice, loadSystemStatus, loadCaptures, loadDeviceAndData]);

    // ─────────────────────────────────────────────────
    // EVENT HANDLERS
    // ─────────────────────────────────────────────────

    const handleModeChange = async (newMode: OperationMode) => {
        if (!currentDevice) return;
        const previousMode = mode;
        setMode(newMode);
        try {
            const ok = await sendModeChange(currentDevice.pi_url, newMode);
            if (!ok) throw new Error('Pi rejected mode change');
            await loadSystemStatus(currentDevice.pi_url);
        } catch (err: any) {
            console.error(err);
            setMode(previousMode);
            Alert.alert('Error', err?.message || 'Failed to change mode');
        }
    };

    const handleToggleLight = async (light: 'foyer' | 'porch', value: boolean) => {
        if (!currentDevice) return;
        const key = `${light}Light` as keyof SystemStatus;
        const previousValue = systemStatus[key];

        setSystemStatus((prev) => ({ ...prev, [key]: value }));

        const success = await sendLightToggle(currentDevice.pi_url, light, value);
        if (!success) {
            Alert.alert('Error', 'Failed to toggle light. Device may be offline.');
            setSystemStatus((prev) => ({ ...prev, [key]: previousValue }));
            return;
        }
        await loadSystemStatus(currentDevice.pi_url);
    };

    const handleDownload = async (captureId: string) => {
        if (!currentDevice) return;
        const capture = captures.find((c) => c.id === captureId);
        if (!capture?.file_name) {
            Alert.alert('Error', 'Video not found');
            return;
        }

        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission Denied', 'We need permission to save videos to your gallery.');
                return;
            }

            setDownloadProgress((prev) => ({ ...prev, [captureId]: 0 }));
            const videoUrl = getVideoStreamUrl(currentDevice.pi_url, capture.file_name);
            const cacheDir = FileSystem.cacheDirectory ?? '';
            const fileUri = `${cacheDir}${capture.file_name}`;

            const downloadResumable = FileSystem.createDownloadResumable(
                videoUrl,
                fileUri,
                {},
                ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
                    const progress = totalBytesWritten / totalBytesExpectedToWrite;
                    setDownloadProgress((prev) => ({ ...prev, [captureId]: Math.round(progress * 100) }));
                }
            );

            const result = await downloadResumable.downloadAsync();
            if (!result?.uri) throw new Error('Download failed');

            const asset = await MediaLibrary.createAssetAsync(result.uri);
            try {
                const album = await MediaLibrary.getAlbumAsync('Solaris');
                if (album) {
                    await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
                } else {
                    await MediaLibrary.createAlbumAsync('Solaris', asset, false);
                }
            } catch (albumError) {
                console.log('Album creation skipped:', albumError);
            }

            Alert.alert('Success', 'Video saved to your gallery!');
        } catch (error: any) {
            console.error('Download error:', error);
            Alert.alert('Download Failed', error.message || 'Could not download video.');
        } finally {
            setDownloadProgress((prev) => {
                const next = { ...prev };
                delete next[captureId];
                return next;
            });
        }
    };

    // FIX: Captures come from the Pi HTTP server, not Supabase — so deletion must target
    // the Pi's /videos/:filename endpoint (or a Supabase table that mirrors Pi state).
    // For now this calls a Pi DELETE endpoint; replace with your actual API contract.
    const handleDelete = async (captureId: string) => {
        if (!currentDevice) return;
        const capture = captures.find((c) => c.id === captureId);
        if (!capture?.file_name) return;

        Alert.alert('Delete Video', 'Are you sure you want to delete this video? This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        const videosEndpoint = getVideosEndpoint(currentDevice.pi_url);
                        const res = await fetch(
                            `${videosEndpoint}/${encodeURIComponent(capture.file_name!)}`,
                            { method: 'DELETE' }
                        );

                        if (!res.ok) throw new Error(`Server returned ${res.status}`);

                        setCaptures((prev) => prev.filter((c) => c.id !== captureId));
                        Alert.alert('Success', 'Video deleted successfully');
                    } catch (error: any) {
                        console.error('Error deleting capture:', error);
                        Alert.alert('Error', error.message || 'Failed to delete video');
                    }
                },
            },
        ]);
    };

    const handleSignOut = () => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => signOut() },
        ]);
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadDeviceAndData();
        setRefreshing(false);
    }, [loadDeviceAndData]);

    // ─────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────

    if (loading) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <Text style={styles.loadingText}>Loading Your Device...</Text>
                </View>
            </SafeAreaView>
        );
    }

    if (!currentDevice) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <Text style={styles.noDeviceTitle}>No Device Connected</Text>
                    <Text style={styles.noDeviceSubtitle}>Please set up your SOLARIS device to get started.</Text>
                    <TouchableOpacity style={styles.setupButton} onPress={() => setShowSetupFlow(true)}>
                        <Text style={styles.setupButtonText}>+ Setup Device</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
                        <Text style={styles.logoutButtonText}>Logout</Text>
                    </TouchableOpacity>
                </View>

                <Modal
                    visible={showSetupFlow}
                    transparent
                    animationType="slide"
                    onRequestClose={() => setShowSetupFlow(false)}
                >
                    <SafeAreaView style={styles.setupModalContainer}>
                        <View style={styles.setupModalHeader}>
                            <TouchableOpacity onPress={() => setShowSetupFlow(false)}>
                                <Text style={styles.setupModalCloseButton}>✕</Text>
                            </TouchableOpacity>
                        </View>
                        <PiSetupFlow
                            userId={session?.user?.id ?? ''}
                            onSetupComplete={() => {
                                setShowSetupFlow(false);
                                loadDeviceAndData();
                            }}
                        />
                    </SafeAreaView>
                </Modal>
            </SafeAreaView>
        );
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaView style={styles.container} edges={['top']}>
                <StatusBar barStyle="dark-content" />
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                >
                    <Header
                        userName={session?.user?.email?.split('@')[0] ?? 'User'}
                        onSettingsPress={() => router.push('/settings')}
                        onSignOutPress={handleSignOut}
                    />

                    <View style={styles.piStatus}>
                        <View style={[styles.statusDot, { backgroundColor: piConnected ? '#4CAF50' : '#F44336' }]} />
                        <Text style={styles.piStatusText}>
                            {currentDevice.name}: {piConnected ? 'Online' : 'Offline'}
                        </Text>
                    </View>

                    <ModeSelector selectedMode={mode} onModeChange={handleModeChange} />
                    <StatusCard status={systemStatus} />

                    <TouchableOpacity
                        style={styles.metricCard}
                        activeOpacity={0.9}
                        onPress={() => router.push('/metrics')}
                    >
                        <View style={styles.metricLegend}>
                            <View style={styles.legendItem}>
                                <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
                                <Text style={styles.legendText}>Camera ({eventCounts.camera})</Text>
                            </View>
                            <View style={styles.legendItem}>
                                <View style={[styles.dot, { backgroundColor: '#3b82f6' }]} />
                                <Text style={styles.legendText}>Indoor PIR ({eventCounts.indoor})</Text>
                            </View>
                            <View style={styles.legendItem}>
                                <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
                                <Text style={styles.legendText}>Outdoor PIR ({eventCounts.outdoor})</Text>
                            </View>
                        </View>

                        <View style={styles.metricChartContainer}>
                            <EventDonut {...eventCounts} />
                            <View style={styles.metricCenter}>
                                <Text style={styles.metricTotalText}>{eventCounts.total}</Text>
                                <Text style={styles.metricLabelText}>Events Today</Text>
                            </View>
                        </View>
                    </TouchableOpacity>

                    {/* FIX: Single consolidated mode content block (removed dead renderModeContent helper). */}
                    {mode === 'manual' && (
                        <ManualControls
                            foyerLight={systemStatus.foyerLight}
                            porchLight={systemStatus.porchLight}
                            onToggleLight={handleToggleLight}
                        />
                    )}
                    {mode === 'scheduled' && <ScheduleControls piId={currentDevice.id} />}

                    <View style={{ height: 250 }} />
                </ScrollView>

                <BottomSheet
                    ref={bottomSheetRef}
                    index={0}
                    snapPoints={['15%', '50%', '90%']}
                    enablePanDownToClose={false}
                    handleIndicatorStyle={styles.bottomSheetIndicator}
                >
                    <RecentCaptures
                        captures={captures}
                        piUrl={currentDevice.pi_url}
                        onDownload={handleDownload}
                        onDelete={handleDelete}
                        downloadProgress={downloadProgress}
                    />
                </BottomSheet>
            </SafeAreaView>
        </GestureHandlerRootView>
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
    scrollContent: {
        padding: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    loadingText: {
        fontSize: 18,
        color: '#666',
        marginTop: 10,
    },
    noDeviceTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#000',
        marginBottom: 10,
        textAlign: 'center',
    },
    noDeviceSubtitle: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        marginBottom: 30,
        paddingHorizontal: 20,
    },
    setupButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 12,
        minWidth: 200,
        marginBottom: 20,
    },
    setupButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
    },
    setupModalContainer: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    setupModalHeader: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    setupModalCloseButton: {
        fontSize: 28,
        color: '#007AFF',
        fontWeight: '300',
    },
    piStatus: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#FFF',
        borderRadius: 8,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    statusDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginRight: 8,
    },
    piStatusText: {
        fontSize: 14,
        color: '#666',
        fontWeight: '500',
    },
    metricCard: {
        flexDirection: 'row',
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 16,
        marginTop: 16,
        marginBottom: 16,
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    metricLegend: { flex: 1 },
    legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
    legendText: { fontSize: 13, color: '#333', fontWeight: '600' },
    metricChartContainer: {
        position: 'relative',
        width: 120,
        height: 120,
        alignItems: 'center',
        justifyContent: 'center',
    },
    metricCenter: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
    metricTotalText: { fontSize: 24, fontWeight: 'bold', color: '#000' },
    metricLabelText: { fontSize: 10, color: '#666', fontWeight: '500' },
    bottomSheetIndicator: {
        backgroundColor: '#CCC',
        width: 40,
    },
    logoutButton: {
        marginTop: 20,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#FF3B30',
        backgroundColor: 'transparent',
    },
    logoutButtonText: {
        color: '#FF3B30',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
    },
});
