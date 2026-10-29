import type { Session, User } from '@supabase/supabase-js'
import { createContext, Fragment, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/database.types'
import { queryCache } from '../lib/cache'
import { clearIssueDraft } from '../lib/issueDraftStore'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>
  signInWithGoogle: () => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>
  updatePassword: (password: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const activeUserId = useRef<string | null>(null)

  const acceptSession = (next: Session | null) => {
    const nextId = next?.user.id ?? null
    if (activeUserId.current !== nextId) {
      activeUserId.current = nextId
      queryCache.setIdentity(nextId)
      clearIssueDraft()
      setProfile(null)
    }
    setSession(next)
  }

  const loadProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (activeUserId.current === userId) setProfile(data ?? null)
  }

  useEffect(() => {
    let active = true
    let receivedAuthEvent = false
    const applySession = (next: Session | null) => {
      if (!active) return
      acceptSession(next)
      if (next) {
        // Defer database work until the auth callback releases its lock.
        queueMicrotask(() => {
          if (!active) return
          void loadProfile(next.user.id).finally(() => {
            if (active) setLoading(false)
          })
        })
      } else {
        setLoading(false)
      }
    }

    void supabase.auth.getSession().then(({ data }) => {
      if (!receivedAuthEvent) applySession(data.session)
    }).catch(() => {
      if (active && !receivedAuthEvent) applySession(null)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        receivedAuthEvent = true
        applySession(newSession)
      },
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) {
      return { error: error.message, needsEmailConfirmation: false }
    }
    const needsEmailConfirmation = !data.session
    return { error: null, needsEmailConfirmation }
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const requestPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { error: error?.message ?? null }
  }

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    return { error: error?.message ?? null }
  }

  const refreshProfile = async () => {
    if (session) {
      await loadProfile(session.user.id)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        refreshProfile,
        requestPasswordReset,
        updatePassword,
      }}
    >
      <Fragment key={session?.user.id ?? 'anonymous'}>{children}</Fragment>
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
