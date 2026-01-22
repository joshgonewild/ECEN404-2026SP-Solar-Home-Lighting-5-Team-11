// app/(app)/dashboard.tsx - (COMPLETE WITH FILE SYSTEM FIX)
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
    TextInput,
    Modal,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BottomSheet from '@gorhom/bottom-sheet';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

// Import components
import Header from '../../components/Header';
import ModeSelector from '../../components/ModeSelector';
import StatusCard from '../../components/StatusCard';
import ManualControls from '../../components/ManualControls';
import ScheduleControls from '../../components/ScheduleControls';
import RecentCaptures from '../../components/RecentCaptures';

// Import lib
import { supabase } from '@/lib/supabase';
import {
    checkPiConnection,
    getVideoStreamUrl,
    sendLightToggle,
} from '@/lib/piServer';
import { SystemStatus, Capture, OperationMode } from '@/lib/types';
import { useAuth } from '@/_context/AuthContext';

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════
interface SolarisDevice {
    id: string;
    user_id: string;
    name: string;
    pi_url: string;
}

interface AddDeviceModalProps {
    visible: boolean;
    onClose: () => void;
    onDeviceClaimed: () => void;
}

// ═══════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════
const formatLastActivation = (timestamp: string): string => {
    if (!timestamp) return 'Never';
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`;
    return `${Math.floor(diffMins / 1440)} days ago`;
};

// ═══════════════════════════════════════════════════
// ADD DEVICE MODAL COMPONENT
// ═══════════════════════════════════════════════════
const AddDeviceModal: React.FC<AddDeviceModalProps> = ({
                                                           visible,
                                                           onClose,
                                                           onDeviceClaimed,
                                                       }) => {
    const [piId, setPiId] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Reset state when modal closes
    useEffect(() => {
        if (!visible) {
            setPiId('');
            setError('');
        }
    }, [visible]);

    const handleClaim = async () => {
        if (!piId.trim()) {
            setError('Please enter a Pi ID');
            return;
        }

        if (loading) return;

        setLoading(true);
        setError('');

        try {
            const { data, error: rpcError } = await supabase.rpc('claim_device', {
                pi_id_to_claim: piId.trim(),
            });

            if (rpcError) {
                console.error('Claim RPC error:', rpcError);
                setError(rpcError.message || 'Failed to claim device');
                return;
            }

            if (data && typeof data === 'string' && data.startsWith('Error:')) {
                console.warn('Claim logic error:', data);
                setError(data.replace('Error: ', ''));
                return;
            }

            // Success!
            Alert.alert('Success', 'Device claimed successfully!');
            setPiId('');
            onDeviceClaimed();
            onClose();
        } catch (err: any) {
            console.error('Exception claiming device:', err);
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.modalBackdrop}>
                <View style={styles.modalContainer}>
                    <Text style={styles.modalTitle}>Add Your Device</Text>
                    <Text style={styles.modalSubtitle}>
                        Enter the unique Pi ID for your Solaris device. This is often found
                        on a sticker or in the device's setup instructions.
                    </Text>

                    <TextInput
                        style={styles.modalInput}
                        placeholder="solaris-pi-001"
                        placeholderTextColor="#999"
                        value={piId}
                        onChangeText={(text) => {
                            setPiId(text);
                            if (error) setError(''); // Clear error when typing
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!loading}
                    />

                    {error ? <Text style={styles.modalError}>{error}</Text> : null}

                    <TouchableOpacity
                        style={[styles.modalButton, loading && styles.modalButtonDisabled]}
                        onPress={handleClaim}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <Text style={styles.modalButtonText}>Claim Device</Text>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.modalCloseButton}
                        onPress={onClose}
                        disabled={loading}
                    >
                        <Text style={[styles.modalCloseText, loading && styles.modalCloseTextDisabled]}>
                            Cancel
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </Modal>
    );
};

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════
export default function DashboardScreen() {
    // ─────────────────────────────────────────────────
    // STATE & CONTEXT
    // ─────────────────────────────────────────────────
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
    const [showAddDeviceModal, setShowAddDeviceModal] = useState(false);

    const bottomSheetRef = useRef<BottomSheet>(null);
    const statusIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const captureIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─────────────────────────────────────────────────
    // DEBUG EFFECT
    // ─────────────────────────────────────────────────
    useEffect(() => {
        const debugFileSystem = async () => {
            console.log('=== FileSystem Debug ===');

            // Try to access via require
            try {
                const fs = require('expo-file-system');
                console.log('expo-file-system keys:', Object.keys(fs));
                console.log('documentDirectory via require:', fs.documentDirectory);
                console.log('cacheDirectory via require:', fs.cacheDirectory);
            } catch (e) {
                console.log('Could not require expo-file-system:', e);
            }
        };

        debugFileSystem();
    }, []);

    // ─────────────────────────────────────────────────
    // DATA LOADING FUNCTIONS
    // ─────────────────────────────────────────────────
    const loadDevice = async (): Promise<SolarisDevice | null> => {
        try {
            const { data, error } = await supabase
                .from('devices')
                .select('*')
                .limit(1)
                .maybeSingle();

            if (error) {
                console.error('Error loading device:', error);
                return null;
            }

            if (!data) {
                console.log('No device found for user.');
                setCurrentDevice(null);
                return null;
            }

            console.log('Loaded device:', data.name);
            const device = data as SolarisDevice;
            setCurrentDevice(device);
            return device;
        } catch (err) {
            console.error('Exception loading device:', err);
            return null;
        }
    };

    const loadSystemStatus = useCallback(async (deviceId?: string) => {
        const id = deviceId || currentDevice?.id;
        if (!id) return;

        try {
            const { data: statusData, error: statusError } = await supabase
                .from('status')
                .select('*')
                .eq('device_id', id)
                .limit(1)
                .maybeSingle();

            if (statusError) throw statusError;

            if (statusData) {
                setSystemStatus({
                    connected: piConnected,
                    foyerLight: statusData.foyer,
                    porchLight: statusData.porch,
                    lastActivated: formatLastActivation(statusData.last_activation),
                    battery: statusData.battery_percentage || 0,
                });
                setMode(statusData.mode_of_operation as OperationMode);
            }
        } catch (error) {
            console.error('Error loading system status:', error);
        }
    }, [currentDevice?.id, piConnected]);

    const loadCaptures = useCallback(async (deviceId?: string) => {
        const id = deviceId || currentDevice?.id;
        if (!id) return;

        try {
            const { data, error } = await supabase
                .from('motion_events')
                .select('*')
                .eq('device_id', id)
                .order('detected_at', { ascending: false })
                .limit(20);

            if (error) throw error;

            if (data) {
                setCaptures(
                    data.map((event) => ({
                        id: event.id,
                        file_name: event.file_name,
                        file_path: event.file_path,
                        file_size: event.file_size || 0,
                        duration: event.duration || 0,
                        detected_at: event.detected_at,
                        timestamp: new Date(event.detected_at).toLocaleString(),
                        location: event.location || 'Front Door',
                        thumbnail_data: event.thumbnail_data,
                        viewed: event.viewed || false,
                        starred: event.starred || false,
                    }))
                );
            }
        } catch (error) {
            console.error('Error loading captures:', error);
        }
    }, [currentDevice?.id]);

    const checkPi = useCallback(async (piUrl?: string) => {
        const url = piUrl || currentDevice?.pi_url;
        if (!url) return;

        const isConnected = await checkPiConnection(url);
        setPiConnected(isConnected);
    }, [currentDevice?.pi_url]);

    const loadDeviceAndData = useCallback(async () => {
        setLoading(true);

        const device = await loadDevice();

        if (device) {
            await Promise.all([
                loadSystemStatus(device.id),
                loadCaptures(device.id),
                checkPi(device.pi_url),
            ]);
        }

        setLoading(false);
    }, [loadSystemStatus, loadCaptures, checkPi]);

    // ─────────────────────────────────────────────────
    // EFFECTS
    // ─────────────────────────────────────────────────

    // Initial load
    useEffect(() => {
        loadDeviceAndData();
    }, []);

    // Setup polling and app state listener
    useEffect(() => {
        // Clear any existing intervals
        if (statusIntervalRef.current) {
            clearInterval(statusIntervalRef.current);
        }
        if (captureIntervalRef.current) {
            clearInterval(captureIntervalRef.current);
        }

        // Only poll if we have a device and app is active
        if (isActive && currentDevice) {
            // Poll for status updates every 5 seconds
            statusIntervalRef.current = setInterval(() => {
                loadSystemStatus();
                checkPi();
            }, 5000);

            // Poll for captures every 30 seconds
            captureIntervalRef.current = setInterval(() => {
                loadCaptures();
            }, 30000);
        }

        // Listen for app state changes
        const subscription = AppState.addEventListener(
            'change',
            (state: AppStateStatus) => {
                setIsActive(state === 'active');
                if (state === 'active' && currentDevice) {
                    loadDeviceAndData();
                }
            }
        );

        // Cleanup
        return () => {
            if (statusIntervalRef.current) {
                clearInterval(statusIntervalRef.current);
            }
            if (captureIntervalRef.current) {
                clearInterval(captureIntervalRef.current);
            }
            subscription.remove();
        };
    }, [isActive, currentDevice, loadSystemStatus, loadCaptures, checkPi, loadDeviceAndData]);

    // ─────────────────────────────────────────────────
    // EVENT HANDLERS
    // ─────────────────────────────────────────────────

    const handleModeChange = async (newMode: OperationMode) => {
        if (!currentDevice) return;

        const previousMode = mode;

        try {
            setMode(newMode); // Optimistic update

            const { error } = await supabase
                .from('status')
                .update({ mode_of_operation: newMode })
                .eq('device_id', currentDevice.id);

            if (error) {
                console.error('Error updating mode:', error);
                Alert.alert('Error', 'Failed to change mode');
                setMode(previousMode); // Revert
            }
        } catch (error) {
            console.error('Exception in handleModeChange:', error);
            setMode(previousMode); // Revert
        }
    };

    const handleToggleLight = async (light: 'foyer' | 'porch', value: boolean) => {
        if (!currentDevice) return;

        // Store previous value for rollback
        const previousValue = systemStatus[`${light}Light` as keyof SystemStatus];

        // Optimistic update
        setSystemStatus((prev) => ({
            ...prev,
            [`${light}Light`]: value,
        }));

        const success = await sendLightToggle(currentDevice.pi_url, light, value);

        if (!success) {
            Alert.alert('Error', 'Failed to toggle light. Device may be offline.');
            // Revert optimistic update
            setSystemStatus((prev) => ({
                ...prev,
                [`${light}Light`]: previousValue,
            }));
        }
    };

    const handleDownload = async (captureId: string) => {
        if (!currentDevice) return;

        const capture = captures.find((c) => c.id === captureId);
        if (!capture || !capture.file_name) {
            Alert.alert('Error', 'Video not found');
            return;
        }

        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert(
                    'Permission Denied',
                    'We need permission to save videos to your gallery.'
                );
                return;
            }

            setDownloadProgress((prev) => ({ ...prev, [captureId]: 0 }));

            const videoUrl = getVideoStreamUrl(currentDevice.pi_url, capture.file_name);

            // Try to get cache directory
            let fileUri: string;
            try {
                const cacheDir = FileSystem.cacheDirectory;
                if (cacheDir) {
                    fileUri = `${cacheDir}${capture.file_name}`;
                } else {
                    throw new Error('Cache directory unavailable');
                }
            } catch {
                // Fallback: use a temp path
                fileUri = `/cache/${capture.file_name}`;
            }

            console.log('Downloading from:', videoUrl);
            console.log('Saving to:', fileUri);

            const downloadResumable = FileSystem.createDownloadResumable(
                videoUrl,
                fileUri,
                {},
                (downloadProgressData) => {
                    const progress =
                        downloadProgressData.totalBytesWritten /
                        downloadProgressData.totalBytesExpectedToWrite;
                    setDownloadProgress((prev) => ({
                        ...prev,
                        [captureId]: Math.round(progress * 100),
                    }));
                }
            );

            const result = await downloadResumable.downloadAsync();

            if (!result || !result.uri) {
                throw new Error('Download failed');
            }

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
                const newProgress = { ...prev };
                delete newProgress[captureId];
                return newProgress;
            });
        }
    };

    const handleDelete = async (captureId: string) => {
        Alert.alert(
            'Delete Video',
            'Are you sure you want to delete this video? This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const { error } = await supabase
                                .from('motion_events')
                                .delete()
                                .eq('id', captureId);

                            if (error) {
                                console.error('Error deleting capture:', error);
                                Alert.alert('Error', 'Failed to delete video');
                            } else {
                                setCaptures((prev) => prev.filter((c) => c.id !== captureId));
                                Alert.alert('Success', 'Video deleted successfully');
                            }
                        } catch (error) {
                            console.error('Exception in delete:', error);
                            Alert.alert('Error', 'An unexpected error occurred');
                        }
                    },
                },
            ]
        );
    };

    const handleSignOut = () => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Sign Out',
                style: 'destructive',
                onPress: () => signOut(),
            },
        ]);
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadDeviceAndData();
        setRefreshing(false);
    }, [loadDeviceAndData]);

    // ─────────────────────────────────────────────────
    // RENDER HELPERS
    // ─────────────────────────────────────────────────

    const renderModeContent = () => {
        switch (mode) {
            case 'manual':
                return (
                    <ManualControls
                        foyerLight={systemStatus.foyerLight}
                        porchLight={systemStatus.porchLight}
                        onToggleLight={handleToggleLight}
                    />
                );
            case 'scheduled':
                return <ScheduleControls />;
            case 'automatic':
            default:
                return null;
        }
    };

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

    // "No Device" screen
    if (!currentDevice) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <Text style={styles.noDeviceTitle}>No Device Connected</Text>
                    <Text style={styles.noDeviceSubtitle}>
                        Please add your SOLARIS device to get started.
                    </Text>
                    <TouchableOpacity
                        style={styles.addDeviceButton}
                        onPress={() => setShowAddDeviceModal(true)}
                    >
                        <Text style={styles.addDeviceButtonText}>+ Add Device</Text>
                    </TouchableOpacity>

                    {/* Logout Button */}
                    <TouchableOpacity
                        style={styles.logoutButton}
                        onPress={handleSignOut}
                    >
                        <Text style={styles.logoutButtonText}>Logout</Text>
                    </TouchableOpacity>
                </View>

                <AddDeviceModal
                    visible={showAddDeviceModal}
                    onClose={() => setShowAddDeviceModal(false)}
                    onDeviceClaimed={loadDeviceAndData}
                />
            </SafeAreaView>
        );
    }

    // Main Dashboard Render
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaView style={styles.container} edges={['top']}>
                <StatusBar barStyle="dark-content" />

                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                    }
                >
                    <Header
                        userName={session?.user?.email?.split('@')[0] || 'User'}
                        onProfilePress={handleSignOut}
                    />

                    <View style={styles.piStatus}>
                        <View
                            style={[
                                styles.statusDot,
                                { backgroundColor: piConnected ? '#4CAF50' : '#F44336' },
                            ]}
                        />
                        <Text style={styles.piStatusText}>
                            {currentDevice.name}: {piConnected ? 'Online' : 'Offline'}
                        </Text>
                    </View>

                    <ModeSelector selectedMode={mode} onModeChange={handleModeChange} />
                    <StatusCard status={systemStatus} />
                    {renderModeContent()}

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

            <AddDeviceModal
                visible={showAddDeviceModal}
                onClose={() => setShowAddDeviceModal(false)}
                onDeviceClaimed={loadDeviceAndData}
            />
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
    addDeviceButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 12,
        minWidth: 200,
    },
    addDeviceButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
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
    bottomSheetIndicator: {
        backgroundColor: '#CCC',
        width: 40,
    },

    // Modal Styles
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContainer: {
        width: '100%',
        maxWidth: 400,
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#000',
        marginBottom: 10,
    },
    modalSubtitle: {
        fontSize: 15,
        color: '#666',
        textAlign: 'center',
        marginBottom: 20,
        lineHeight: 22,
    },
    modalInput: {
        width: '100%',
        height: 50,
        backgroundColor: '#F0F0F0',
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        color: '#000',
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        textAlign: 'center',
    },
    modalError: {
        color: '#D32F2F',
        marginBottom: 10,
        textAlign: 'center',
        fontSize: 14,
    },
    modalButton: {
        width: '100%',
        height: 50,
        backgroundColor: '#007AFF',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalButtonDisabled: {
        backgroundColor: '#BDBDBD',
    },
    modalButtonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '600',
    },
    modalCloseButton: {
        marginTop: 12,
        paddingVertical: 8,
    },
    modalCloseText: {
        color: '#007AFF',
        fontSize: 16,
    },
    modalCloseTextDisabled: {
        color: '#999',
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