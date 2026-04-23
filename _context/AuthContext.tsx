import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useRouter, useSegments } from 'expo-router';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    isLoading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    updatePassword: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
                                                                          children,
                                                                      }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const segments = useSegments();

    useEffect(() => {
        const fetchSession = async () => {
            try {
                const {
                    data: { session },
                } = await supabase.auth.getSession();
                setSession(session);
                setUser(session?.user ?? null);
            } catch (error) {
                console.error('Error fetching session:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSession();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);

            if (_event === 'PASSWORD_RECOVERY') {
                router.replace('/(auth)/update-password');
            }
        });

        return () => {
            subscription?.unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (isLoading) return;

        const inAuthGroup = segments[0] === '(auth)';

        if (!session && !inAuthGroup) {
            router.replace('/(auth)');
        } else if (session && inAuthGroup) {
            router.replace('/(app)/dashboard');
        }
    }, [session, isLoading, segments, router]);

    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            Alert.alert('Sign In Error', error.message);
        }
    };

    const signUp = async (email: string, password: string) => {
        const {
            data: { session },
            error,
        } = await supabase.auth.signUp({
            email,
            password,
        });
        if (error) {
            Alert.alert('Sign Up Error', error.message);
        } else if (!session) {
            Alert.alert(
                'Sign Up Successful',
                'Please check your email to confirm your account.'
            );
        }
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            Alert.alert('Sign Out Error', error.message);
        }
    };

    const resetPassword = async (email: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: 'solarhome://reset-password',
        });
        if (error) {
            Alert.alert('Error', error.message);
        } else {
            Alert.alert('Check your email', 'A password reset link has been sent.');
        }
    };

    const updatePassword = async (newPassword: string) => {
        const { error } = await supabase.auth.updateUser({ password: newPassword });
        if (error) {
            Alert.alert('Error', error.message);
        } else {
            Alert.alert('Success', 'Your password has been updated.');
            router.replace('/(app)/dashboard');
        }
    };

    const value = {
        session,
        user,
        isLoading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
    };

    return (
        <AuthContext.Provider value={value}>
            {!isLoading && children}
        </AuthContext.Provider>
    );
};
