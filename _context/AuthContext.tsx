import { supabase } from '../lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { useRouter, useSegments } from 'expo-router';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';

// Define the shape of the Auth context
interface AuthContextType {
    session: Session | null;
    user: User | null;
    isLoading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
}

// Create the Auth context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Custom hook to use the Auth context
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

// AuthProvider component
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
                                                                          children,
                                                                      }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();
    const segments = useSegments();

    // Effect to load session and listen for auth changes
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

        // Listen for auth state changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
        });

        // Unsubscribe on unmount
        return () => {
            subscription?.unsubscribe();
        };
    }, []);

    // Effect to handle redirection based on auth state
    useEffect(() => {
        if (isLoading) return;

        const inAuthGroup = segments[0] === '(auth)';

        if (!session && !inAuthGroup) {
            // Redirect to login screen if not authenticated
            router.replace('/(auth)');
        } else if (session && inAuthGroup) {
            // Redirect to dashboard if authenticated
            router.replace('/(app)/dashboard');
        }
    }, [session, isLoading, segments, router]);

    // Sign in function
    const signIn = async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) {
            Alert.alert('Sign In Error', error.message);
        }
    };

    // Sign up function
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

    // Sign out function
    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            Alert.alert('Sign Out Error', error.message);
        }
        // The onAuthStateChange listener will handle setting session to null
        // and the redirection effect will trigger.
    };

    const value = {
        session,
        user,
        isLoading,
        signIn,
        signUp,
        signOut,
    };

    // Render children only when not loading
    return (
        <AuthContext.Provider value={value}>
            {!isLoading && children}
        </AuthContext.Provider>
    );
};