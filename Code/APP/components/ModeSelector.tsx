// components/ModeSelector.tsx - FIXED TOGGLE VERSION
import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    Animated,
} from 'react-native';
import { OperationMode } from '../lib/types';

interface ModeSelectorProps {
    selectedMode: OperationMode;
    onModeChange: (mode: OperationMode) => void;
}

const MODES = [
    { label: 'Automatic', value: 'automatic' as OperationMode },
    { label: 'Manual', value: 'manual' as OperationMode },
    { label: 'Scheduled', value: 'scheduled' as OperationMode },
];

export default function ModeSelector({
                                         selectedMode,
                                         onModeChange,
                                     }: ModeSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [dropdownLayout, setDropdownLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
    const buttonRef = useRef<View>(null);
    const slideAnim = useRef(new Animated.Value(0)).current;

    const selectedLabel = MODES.find(m => m.value === selectedMode)?.label || 'Automatic';

    // Animate when isOpen changes
    useEffect(() => {
        Animated.spring(slideAnim, {
            toValue: isOpen ? 1 : 0,  // ← This now handles both open AND close
            tension: 50,
            friction: 7,
            useNativeDriver: true,
        }).start();
    }, [isOpen]);

    const handleToggle = () => {  // ← Changed from handleOpen to handleToggle
        if (!isOpen) {
            // Opening - measure position
            buttonRef.current?.measureInWindow((x, y, width, height) => {
                setDropdownLayout({ x, y: y + height, width, height });
                setIsOpen(true);
            });
        } else {
            // Closing - just toggle state
            setIsOpen(false);
        }
    };

    const handleSelect = (mode: OperationMode) => {
        onModeChange(mode);
        setIsOpen(false);  // This will trigger the animation
    };

    const handleClose = () => {
        setIsOpen(false);  // This will also trigger the animation
    };

    return (
        <View style={styles.container}>
            <Text style={styles.label}>Mode of Operation:</Text>

            <View ref={buttonRef} collapsable={false}>
                <TouchableOpacity
                    style={[styles.selector, isOpen && styles.selectorOpen]}
                    onPress={handleToggle}  // ← Changed from handleOpen
                    activeOpacity={0.7}
                >
                    <Text style={styles.selectedText}>{selectedLabel}</Text>
                    <Animated.Text
                        style={[
                            styles.arrow,
                            {
                                transform: [{
                                    rotate: slideAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: ['0deg', '180deg'],
                                    })
                                }]
                            }
                        ]}
                    >
                        ▼
                    </Animated.Text>
                </TouchableOpacity>
            </View>

            <Modal
                visible={isOpen}
                transparent
                animationType="none"
                onRequestClose={handleClose}  // ← Handle back button on Android
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={handleClose}  // ← Use handleClose instead of inline
                >
                    <Animated.View
                        style={[
                            styles.dropdown,
                            {
                                position: 'absolute',
                                top: dropdownLayout.y,
                                left: dropdownLayout.x,
                                width: dropdownLayout.width,
                                opacity: slideAnim,
                                transform: [{
                                    translateY: slideAnim.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [-10, 0],
                                    })
                                }],
                                // Prevent interaction when hidden
                                pointerEvents: isOpen ? 'auto' : 'none',
                            }
                        ]}
                    >
                        {MODES.map((mode, index) => (
                            <TouchableOpacity
                                key={mode.value}
                                style={[
                                    styles.dropdownItem,
                                    selectedMode === mode.value && styles.dropdownItemSelected,
                                    index === 0 && styles.dropdownItemFirst,
                                    index === MODES.length - 1 && styles.dropdownItemLast,
                                ]}
                                onPress={() => handleSelect(mode.value)}
                                activeOpacity={0.7}
                            >
                                <Text style={[
                                    styles.dropdownItemText,
                                    selectedMode === mode.value && styles.dropdownItemTextSelected,
                                ]}>
                                    {mode.label}
                                </Text>
                                {selectedMode === mode.value && (
                                    <Text style={styles.checkmark}>✓</Text>
                                )}
                            </TouchableOpacity>
                        ))}
                    </Animated.View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#D9D9D9',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000',
        flex: 1,
    },
    selector: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFF',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 16,
        minWidth: 160,
        justifyContent: 'space-between',
    },
    selectorOpen: {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
    },
    selectedText: {
        fontSize: 16,
        color: '#000',
        marginRight: 8,
    },
    arrow: {
        fontSize: 12,
        color: '#666',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    dropdown: {
        backgroundColor: '#FFF',
        borderRadius: 8,
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    dropdownItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 14,
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    dropdownItemFirst: {
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
    },
    dropdownItemLast: {
        borderBottomLeftRadius: 8,
        borderBottomRightRadius: 8,
        borderBottomWidth: 0,
    },
    dropdownItemSelected: {
        backgroundColor: '#F5F5F5',
    },
    dropdownItemText: {
        fontSize: 16,
        color: '#000',
    },
    dropdownItemTextSelected: {
        fontWeight: '600',
        color: '#4CAF50',
    },
    checkmark: {
        fontSize: 16,
        color: '#4CAF50',
        fontWeight: 'bold',
    },
});