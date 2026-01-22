import { useAuth } from '@/_context/AuthContext';
import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Image,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AuthScreen() {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { signIn, signUp } = useAuth();

    const handleAuthAction = async () => {
        if (loading) return;
        setLoading(true);

        try {
            if (isLogin) {
                await signIn(email, password);
            } else {
                await signUp(email, password);
            }
        } catch (error: any) {
            Alert.alert('Error', error.message || 'An unknown error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardAvoidingView}
            >
                <View style={styles.innerContainer}>
                    {/* App Logo */}
                    <Image
                        source={require('../../assets/images/icon.png')}
                        style={styles.logo}
                    />
                    <Text style={styles.title}>{isLogin ? 'Welcome Back' : 'Create Account'}</Text>
                    <Text style={styles.subtitle}>
                        {isLogin ? 'Sign in to your SOLARIS account' : 'Get started with SOLARIS'}
                    </Text>

                    {/* Form Inputs */}
                    <View style={styles.inputContainer}>
                        <TextInput
                            style={styles.input}
                            placeholder="Email"
                            placeholderTextColor="#999"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            textContentType="emailAddress"
                        />
                        <TextInput
                            style={styles.input}
                            placeholder="Password"
                            placeholderTextColor="#999"
                            value={password}
                            onChangeText={setPassword}
                            autoCapitalize="none"
                            secureTextEntry
                            textContentType="password"
                        />
                    </View>

                    {/* Auth Button */}
                    <TouchableOpacity
                        style={[styles.button, loading && styles.buttonDisabled]}
                        onPress={handleAuthAction}
                        disabled={loading}
                    >
                        {loading ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <Text style={styles.buttonText}>
                                {isLogin ? 'Sign In' : 'Sign Up'}
                            </Text>
                        )}
                    </TouchableOpacity>

                    {/* Toggle Button */}
                    <TouchableOpacity
                        style={styles.toggleButton}
                        onPress={() => setIsLogin(!isLogin)}
                        disabled={loading}
                    >
                        <Text style={styles.toggleText}>
                            {isLogin
                                ? "Don't have an account? Sign Up"
                                : 'Already have an account? Sign In'}
                        </Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    keyboardAvoidingView: {
        flex: 1,
    },
    innerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    logo: {
        width: 120,
        height: 120,
        resizeMode: 'contain',
        marginBottom: 24,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#000',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#666',
        marginBottom: 32,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 20,
    },
    input: {
        width: '100%',
        height: 50,
        backgroundColor: '#FFF',
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 16,
        color: '#000',
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    button: {
        width: '100%',
        height: 50,
        backgroundColor: '#007AFF', // A modern blue
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 5,
    },
    buttonDisabled: {
        backgroundColor: '#BDBDBD',
        shadowOpacity: 0,
        elevation: 0,
    },
    buttonText: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '600',
    },
    toggleButton: {
        marginTop: 24,
    },
    toggleText: {
        color: '#007AFF',
        fontSize: 16,
        fontWeight: '500',
    },
});