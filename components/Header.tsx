// components/Header.tsx
import React, { useState, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    Modal,
    TouchableWithoutFeedback
} from 'react-native';

interface HeaderProps {
    userName: string;
    onSettingsPress?: () => void;
    onSignOutPress?: () => void;
}

export default function Header({ userName, onSettingsPress, onSignOutPress }: HeaderProps) {
    const [menuVisible, setMenuVisible] = useState(false);

    const handleMenuToggle = () => {
        setMenuVisible(!menuVisible);
    };

    const handleSettingsPress = () => {
        setMenuVisible(false);
        onSettingsPress?.();
    };

    const handleSignOutPress = () => {
        setMenuVisible(false);
        onSignOutPress?.();
    };

    return (
        <View style={styles.container}>
            <View>
                <Text style={styles.greeting}>Hi, {userName}</Text>
                <Text style={styles.title}>Dashboard</Text>
            </View>
            <View style={styles.rightContainer}>
                {/* Profile/User Button */}
                <TouchableOpacity
                    style={styles.profileButton}
                    onPress={handleMenuToggle}
                >
                    <Image
                        source={require('../assets/images/profile-placeholder.png')}
                        style={styles.profileImage}
                    />
                </TouchableOpacity>

                {/* Dropdown Menu */}
                <Modal
                    visible={menuVisible}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setMenuVisible(false)}
                >
                    <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
                        <View style={styles.modalOverlay}>
                            <TouchableWithoutFeedback>
                                <View style={styles.dropdownMenu}>
                                    <TouchableOpacity
                                        style={styles.menuItem}
                                        onPress={handleSettingsPress}
                                    >
                                        <Text style={styles.menuItemText}>Settings</Text>
                                    </TouchableOpacity>
                                    <View style={styles.menuDivider} />
                                    <TouchableOpacity
                                        style={styles.menuItem}
                                        onPress={handleSignOutPress}
                                    >
                                        <Text style={[styles.menuItemText, styles.signOutText]}>
                                            Sign Out
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </Modal>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    rightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    greeting: {
        fontSize: 16,
        color: '#666',
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#000',
    },
    profileButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#E0E0E0',
    },
    profileImage: {
        width: '100%',
        height: '100%',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        paddingTop: 60,
        paddingRight: 16,
    },
    dropdownMenu: {
        backgroundColor: '#FFF',
        borderRadius: 12,
        minWidth: 160,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
        elevation: 8,
        overflow: 'hidden',
    },
    menuItem: {
        paddingVertical: 14,
        paddingHorizontal: 16,
    },
    menuItemText: {
        fontSize: 16,
        color: '#000',
        fontWeight: '500',
    },
    signOutText: {
        color: '#FF3B30',
    },
    menuDivider: {
        height: 1,
        backgroundColor: '#E0E0E0',
    },
});