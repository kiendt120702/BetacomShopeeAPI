"use client";

import { createContext, useContext, ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'

interface AuthContextType extends ReturnType<typeof useAuth> {
  refreshProfile: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()

  // refreshProfile là alias cho updateProfile để tương thích với code mẫu
  const refreshProfile = () => {
    auth.updateProfile()
  }

  return (
    <AuthContext.Provider value={{ ...auth, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider')
  }
  return context
}