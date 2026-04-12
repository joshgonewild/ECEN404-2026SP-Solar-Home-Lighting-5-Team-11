import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CartesianChart, Line, Area } from 'victory-native';
import { useFont } from '@shopify/react-native-skia';
import Svg, { Circle } from 'react-native-svg';
import { supabase } from '../../lib/supabase';

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

interface TriggerEvent {
    sensor_triggered: 'camera' | 'indoor_pir' | 'outdoor_pir';
}

interface BatteryLogRaw {
    time: string;
    percentage: number;
}

interface LuxLogRaw {
    time: string;
    value: number;
}

interface ChartPoint {
    time: number;
    value: number;
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

function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function formatDateLabel(date: Date): string {
    const today = startOfLocalDay(new Date());
    const target = startOfLocalDay(date);
    const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return target.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function bucketByHour<T extends { time: string }>(
    rows: T[],
    valueKey: keyof T,
): ChartPoint[] {
    const buckets: (number | null)[] = new Array(24).fill(null);

    for (const row of rows) {
        const hour = new Date(row.time).getHours();
        if (hour >= 0 && hour < 24) {
            buckets[hour] = row[valueKey] as number;
        }
    }

    const firstReal = buckets.find((v) => v !== null) ?? 0;
    let last = firstReal;
    return buckets.map((v, i) => {
        if (v !== null) last = v;
        return { time: i, value: last };
    });
}

/** Formats an integer hour (0–23) as zero-padded 24h string: 0→"00:00", 8→"08:00". */
function formatHourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`;
}

// ═══════════════════════════════════════════════════
// AXIS CONFIG
// ═══════════════════════════════════════════════════

// Only label every 4 hours — 6 ticks total, never crowded.
const X_TICK_VALUES = [0, 4, 8, 12, 16, 20];

// Battery: 0–100%, 5 ticks at round numbers.
const BATTERY_Y_TICKS = [0, 25, 50, 75, 100];

// LUX: 0–1100, ticks every 200 units.
const LUX_Y_TICKS = [0, 200, 400, 600, 800, 1000];

// ═══════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════

const LegendItem = ({ color, label, count }: { color: string; label: string; count: number }) => (
    <View style={styles.legendItem}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={styles.legendText}>{label} ({count})</Text>
    </View>
);

const DonutChart = ({ camera, indoor, outdoor, total }: EventCounts) => {
    const radius = 60;
    const circ = 2 * Math.PI * radius;
    const safeTotal = total || 1;
    return (
        <Svg width={160} height={160} viewBox="0 0 160 160">
            <Circle cx="80" cy="80" r={radius} fill="none" stroke="#ef4444" strokeWidth="15"
                    strokeDasharray={`${(camera / safeTotal) * circ} ${circ}`}
                    rotation="-90" origin="80,80" strokeLinecap="round" />
            <Circle cx="80" cy="80" r={radius} fill="none" stroke="#3b82f6" strokeWidth="15"
                    strokeDasharray={`${(indoor / safeTotal) * circ} ${circ}`}
                    rotation={-90 + (camera / safeTotal * 360)} origin="80,80" strokeLinecap="round" />
            <Circle cx="80" cy="80" r={radius} fill="none" stroke="#22c55e" strokeWidth="15"
                    strokeDasharray={`${(outdoor / safeTotal) * circ} ${circ}`}
                    rotation={-90 + ((camera + indoor) / safeTotal * 360)} origin="80,80" strokeLinecap="round" />
        </Svg>
    );
};

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════

export default function MetricsScreen() {
    const [selectedDate, setSelectedDate] = useState<Date>(() => startOfLocalDay(new Date()));
    const [eventData, setEventData] = useState<TriggerEvent[] | null>(null);
    const [batteryData, setBatteryData] = useState<BatteryLogRaw[]>([]);
    const [luxData, setLuxData] = useState<LuxLogRaw[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const font = useFont(require('../../assets/fonts/Inter-Regular.ttf'), 12);

    const isToday = useMemo(() => {
        return selectedDate.getTime() === startOfLocalDay(new Date()).getTime();
    }, [selectedDate]);

    const goBack = useCallback(() => {
        setSelectedDate(prev => {
            const d = new Date(prev);
            d.setDate(d.getDate() - 1);
            return d;
        });
    }, []);

    const goForward = useCallback(() => {
        if (isToday) return;
        setSelectedDate(prev => {
            const d = new Date(prev);
            d.setDate(d.getDate() + 1);
            return d;
        });
    }, [isToday]);

    const fetchData = useCallback(async (date: Date) => {
        setLoading(true);
        setError(null);
        try {
            const start = startOfLocalDay(date).toISOString();
            const end = endOfLocalDay(date).toISOString();

            const [eventsRes, batteryRes, luxRes] = await Promise.all([
                supabase
                    .from('trigger_events')
                    .select('sensor_triggered')
                    .gte('created_at', start)
                    .lte('created_at', end),
                supabase
                    .from('battery_logs')
                    .select('time, percentage')
                    .gte('time', start)
                    .lte('time', end)
                    .order('time', { ascending: true }),
                supabase
                    .from('lux_logs')
                    .select('time, value')
                    .gte('time', start)
                    .lte('time', end)
                    .order('time', { ascending: true }),
            ]);

            if (eventsRes.error) throw eventsRes.error;
            if (batteryRes.error) throw batteryRes.error;
            if (luxRes.error) throw luxRes.error;

            setEventData((eventsRes.data as TriggerEvent[]) ?? []);
            setBatteryData((batteryRes.data as BatteryLogRaw[]) ?? []);
            setLuxData((luxRes.data as LuxLogRaw[]) ?? []);
        } catch (err: any) {
            console.error('MetricsScreen fetch error:', err);
            setError(err?.message ?? 'Failed to load metrics. Please try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData(selectedDate);
    }, [fetchData, selectedDate]);

    const counts = useMemo<EventCounts>(() => {
        const camera = eventData?.filter((e) => e.sensor_triggered === 'camera').length ?? 0;
        const indoor = eventData?.filter((e) => e.sensor_triggered === 'indoor_pir').length ?? 0;
        const outdoor = eventData?.filter((e) => e.sensor_triggered === 'outdoor_pir').length ?? 0;
        return { camera, indoor, outdoor, total: camera + indoor + outdoor };
    }, [eventData]);

    const batteryChartData = useMemo(() => bucketByHour(batteryData, 'percentage'), [batteryData]);
    const luxChartData = useMemo(() => bucketByHour(luxData, 'value'), [luxData]);

    if (!font) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#3b82f6" />
            </View>
        );
    }

    return (
        <ScrollView style={styles.container}>

            {/* Date navigation */}
            <View style={styles.dateHeader}>
                <TouchableOpacity onPress={goBack} style={styles.arrowButton} hitSlop={12}>
                    <Text style={styles.arrowText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.dateLabel}>{formatDateLabel(selectedDate)}</Text>
                <TouchableOpacity
                    onPress={goForward}
                    style={[styles.arrowButton, isToday && styles.arrowDisabled]}
                    disabled={isToday}
                    hitSlop={12}
                >
                    <Text style={[styles.arrowText, isToday && styles.arrowTextDisabled]}>›</Text>
                </TouchableOpacity>
            </View>

            {loading && (
                <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="large" color="#3b82f6" />
                </View>
            )}

            {error && !loading && (
                <View style={styles.center}>
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => fetchData(selectedDate)}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {!loading && !error && (
                <>
                    {/* Donut */}
                    <View style={styles.topSection}>
                        <View style={styles.legend}>
                            <LegendItem color="#ef4444" label="Camera" count={counts.camera} />
                            <LegendItem color="#3b82f6" label="Indoor" count={counts.indoor} />
                            <LegendItem color="#22c55e" label="Outdoor" count={counts.outdoor} />
                        </View>
                        <View style={styles.pieContainer}>
                            <DonutChart {...counts} />
                            <View style={styles.pieCenter}>
                                <Text style={styles.pieValue}>{counts.total}</Text>
                                <Text style={styles.pieLabel}>Events</Text>
                            </View>
                        </View>
                    </View>

                    {/* Battery chart */}
                    <View style={styles.chartSection}>
                        <Text style={styles.chartTitle}>Battery</Text>
                        <View style={{ height: 220 }}>
                            <CartesianChart
                                data={batteryChartData}
                                xKey="time"
                                yKeys={['value']}
                                domain={{ y: [0, 100] }}
                                axisOptions={{
                                    font,
                                    labelColor: '#666',
                                    tickValues: X_TICK_VALUES,
                                    yTickValues: BATTERY_Y_TICKS,
                                    formatXLabel: (v) => formatHourLabel(v as number),
                                    formatYLabel: (v) => `${v}%`,
                                }}
                            >
                                {({ points, chartBounds }) => (
                                    <>
                                        <Area points={points.value} y0={chartBounds.bottom} color="#dcfce7" opacity={0.5} />
                                        <Line points={points.value} color="#22c55e" strokeWidth={2} />
                                    </>
                                )}
                            </CartesianChart>
                        </View>
                    </View>

                    {/* LUX chart */}
                    <View style={styles.chartSection}>
                        <Text style={styles.chartTitle}>LUX</Text>
                        <View style={{ height: 220 }}>
                            <CartesianChart
                                data={luxChartData}
                                xKey="time"
                                yKeys={['value']}
                                domain={{ y: [0, 1100] }}
                                axisOptions={{
                                    font,
                                    labelColor: '#666',
                                    tickValues: X_TICK_VALUES,
                                    yTickValues: LUX_Y_TICKS,
                                    formatXLabel: (v) => formatHourLabel(v as number),
                                    formatYLabel: (v) => `${v}`,
                                }}
                            >
                                {({ points, chartBounds }) => (
                                    <>
                                        <Area points={points.value} y0={chartBounds.bottom} color="#fef3c7" opacity={0.5} />
                                        <Line points={points.value} color="#ca8a04" strokeWidth={2} />
                                    </>
                                )}
                            </CartesianChart>
                        </View>
                    </View>
                </>
            )}

            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

// ═══════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff', padding: 16 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    dateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20, gap: 16 },
    arrowButton: { padding: 4 },
    arrowDisabled: { opacity: 0.25 },
    arrowText: { fontSize: 32, lineHeight: 34, color: '#3b82f6', fontWeight: '300' },
    arrowTextDisabled: { color: '#999' },
    dateLabel: { fontSize: 18, fontWeight: '700', color: '#111', minWidth: 130, textAlign: 'center' },
    loadingOverlay: { paddingVertical: 60, alignItems: 'center' },
    errorText: { fontSize: 15, color: '#ef4444', textAlign: 'center', marginBottom: 16 },
    retryButton: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: '#3b82f6' },
    retryButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
    topSection: { flexDirection: 'row', backgroundColor: '#f8f9fa', borderRadius: 16, padding: 16, marginBottom: 20, alignItems: 'center' },
    legend: { flex: 1 },
    legendItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    legendText: { fontSize: 13, fontWeight: '600' },
    pieContainer: { width: 160, height: 160, justifyContent: 'center', alignItems: 'center' },
    pieCenter: { position: 'absolute', alignItems: 'center' },
    pieValue: { fontSize: 28, fontWeight: 'bold' },
    pieLabel: { fontSize: 10, color: '#666' },
    chartSection: { backgroundColor: '#f8f9fa', borderRadius: 16, padding: 16, marginBottom: 20 },
    chartTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
});
