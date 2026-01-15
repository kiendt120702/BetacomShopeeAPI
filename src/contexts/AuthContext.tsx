/* eslint-disable react-refresh/only-export-components */
/**
 * AuthContext - Share auth state across all components
 * Giải quyết vấn đề mỗi useAuth() tạo state riêng
 */

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { supabase, forceRefreshSession, isJwtExpiredError } from '@/lib/supabase';
import { User, Session } from '@supabase/supabase-js';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  system_role: string | null;
  join_date: string | null;
  created_at: string;
  updated_at: string;
  role_display_name?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ success: boolean; needsConfirmation?: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  clearError: () => void;
  updateProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function getUserProfile(userId: string): Promise<Profile | null> {
  const { data: profileData, error: profileError } = await supabase
    .from('sys_profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (profileError) {
    // Nếu JWT expired, thử refresh session
    if (isJwtExpiredError(profileError)) {
      console.log('[Auth] JWT expired, attempting refresh...');
      const refreshed = await forceRefreshSession();
      if (refreshed) {
        // Retry sau khi refresh
        const { data: retryData, error: retryError } = await supabase
          .from('sys_profiles')
          .select('*')
          .eq('id', userId)
          .single();
        
        if (!retryError && retryData) {
          return {
            ...retryData,
            role_display_name: retryData.system_role === 'admin' ? 'Admin' : 'User',
          };
        }
      }
      return null;
    }

    if (profileError.code === 'PGRST116') {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: newProfile, error: insertError } = await supabase
        .from('sys_profiles')
        .insert({
          id: userId,
          email: user?.email || '',
          full_name: user?.user_metadata?.full_name || '',
        })
        .select('*')
        .single();

      if (insertError) return null;

      return {
        ...newProfile,
        role_display_name: 'User',
      };
    }

    return null;
  }

  return {
    ...profileData,
    role_display_name: profileData.system_role === 'admin' ? 'Admin' : 'User',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Ref để track session hiện tại cho event handler
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  
  // Flag để biết đã init xong chưa - sau khi init xong thì KHÔNG BAO GIỜ set isLoading = true nữa
  const isInitializedRef = useRef(false);

  const loadProfile = async (userId: string) => {
    const profileData = await getUserProfile(userId);
    setProfile(profileData);
  };

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      console.log('[Auth] Starting initialization...');
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (!mounted) return;

        if (sessionError) {
          console.error('[Auth] Error getting session:', sessionError);
        } else if (currentSession?.user) {
          console.log('[Auth] Found existing session for user:', currentSession.user.id);
          setSession(currentSession);
          setUser(currentSession.user);
          // Load profile nhưng không block init
          loadProfile(currentSession.user.id).catch(err => {
            console.error('[Auth] Error loading profile during init:', err);
          });
        } else {
          console.log('[Auth] No existing session found');
        }
      } catch (err) {
        console.error('[Auth] Init error:', err);
      } finally {
        if (mounted) {
          console.log('[Auth] Initialization complete, setting isLoading = false');
          setIsLoading(false);
          isInitializedRef.current = true;
        }
      }
    };

    initializeAuth();

    // Lắng nghe thay đổi auth state - KHÔNG BAO GIỜ set isLoading = true sau khi init
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return;

        console.log('[Auth] Event:', event, 'Session:', !!newSession);

        switch (event) {
          case 'TOKEN_REFRESHED':
            console.log('[Auth] Token refreshed successfully');
            if (newSession) {
              setSession(newSession);
              setUser(newSession.user);
            }
            break;

          case 'SIGNED_IN':
            if (newSession?.user) {
              const currentUserId = sessionRef.current?.user?.id;
              if (currentUserId !== newSession.user.id) {
                setSession(newSession);
                setUser(newSession.user);
                // Load profile ở background, không block UI
                loadProfile(newSession.user.id);
              } else {
                setSession(newSession);
              }
            }
            break;

          case 'SIGNED_OUT':
            setSession(null);
            setUser(null);
            setProfile(null);
            break;

          case 'USER_UPDATED':
            if (newSession?.user) {
              setSession(newSession);
              setUser(newSession.user);
              loadProfile(newSession.user.id);
            }
            break;
        }
      }
    );

    // Safety timeout cho initial load
    const safetyTimeout = setTimeout(() => {
      if (mounted && !isInitializedRef.current) {
        console.warn('[Auth] Safety timeout triggered');
        setIsLoading(false);
        isInitializedRef.current = true;
      }
    }, 3000);

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signUp = async (email: string, password: string, fullName?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) throw error;

      setUser(data.user);
      setSession(data.session);
      setIsLoading(false);

      return { success: true, needsConfirmation: !data.session };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Đăng ký thất bại';
      setError(message);
      setIsLoading(false);
      return { success: false, error: message };
    }
  };

  const signIn = async (email: string, password: string) => {
    console.log('[Auth] signIn called for:', email);
    setError(null);

    try {
      console.log('[Auth] Calling supabase.auth.signInWithPassword...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      console.log('[Auth] signInWithPassword returned, error:', error, 'user:', data?.user?.id);

      if (error) throw error;

      console.log('[Auth] Setting user and session...');
      setUser(data.user);
      setSession(data.session);
      
      // Load profile ngay sau khi login thành công (không await để không block)
      if (data.user) {
        console.log('[Auth] Loading profile for user:', data.user.id);
        loadProfile(data.user.id);
      }

      console.log('[Auth] signIn success, returning');
      return { success: true };
    } catch (err) {
      console.error('[Auth] signIn error:', err);
      const message = err instanceof Error ? err.message : 'Đăng nhập thất bại';
      setError(message);
      return { success: false, error: message };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      setProfile(null);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Đăng xuất thất bại';
      setError(message);
    }
  };

  const clearError = () => setError(null);

  const updateProfile = async () => {
    if (user) {
      await loadProfile(user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isAuthenticated: !!session,
        isLoading,
        error,
        signUp,
        signIn,
        signOut,
        clearError,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
