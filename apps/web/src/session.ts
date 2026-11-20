import { useCallback, useEffect, useRef, useState } from 'react'
import { api, json, type SessionAccount } from './api.js'

const sessionKey = 'aviarium:session'
const localPlayKey = 'aviarium:local-play'
interface SessionStatus {
  user: SessionAccount | null
  signIn: boolean
  loginEnabled?: boolean
  testEnvironment?: boolean
}

function canPlayLocally() { return localStorage.getItem(localPlayKey) === 'true' }
const validUntil = (account: SessionAccount) => Date.parse(account.expiresAt)

function cachedSession(): SessionAccount | undefined {
  try {
    const account: SessionAccount | null = JSON.parse(localStorage.getItem(sessionKey) ?? 'null')
    if (account && typeof account.id === 'string' && typeof account.name === 'string' &&
        ['user', 'admin'].includes(account.role) && Array.isArray(account.editorGames) &&
        validUntil(account) > Date.now()) return account
  } catch { /* Ignore invalid cached session metadata. */ }
}

export function useSession() {
  const [account, setAccount] = useState<SessionAccount>()
  const [localPlay, setLocalPlay] = useState(false)
  const [checking, setChecking] = useState(true)
  const [online, setOnline] = useState(navigator.onLine)
  const [signIn, setSignIn] = useState<boolean>()
  const request = useRef<AbortController | undefined>(undefined)

  const forget = useCallback(() => {
    request.current?.abort()
    localStorage.removeItem(sessionKey)
    setAccount(undefined)
    setChecking(false)
  }, [])

  const refresh = useCallback(async () => {
    request.current?.abort()
    const pending = new AbortController()
    request.current = pending
    setOnline(navigator.onLine)
    if (!navigator.onLine) {
      const local = canPlayLocally()
      setLocalPlay(local)
      setAccount(local ? undefined : cachedSession())
      setChecking(false)
      return
    }
    try {
      let result = await api<SessionStatus>('/me', { signal: pending.signal })
      if (result.testEnvironment && !result.user && !pending.signal.aborted) {
        await api('/auth/test-role', { ...json('POST', { role: 'user' }), signal: pending.signal })
        result = await api<SessionStatus>('/me', { signal: pending.signal })
      }
      if (pending.signal.aborted) return
      setSignIn(result.signIn)
      const local = !result.testEnvironment && result.loginEnabled === false
      setLocalPlay(local)
      if (local) localStorage.setItem(localPlayKey, 'true')
      else localStorage.removeItem(localPlayKey)
      const verified = !local && result.user && validUntil(result.user) > Date.now() ? result.user : undefined
      if (verified) localStorage.setItem(sessionKey, JSON.stringify(verified))
      else localStorage.removeItem(sessionKey)
      setAccount(verified)
    } catch {
      if (!pending.signal.aborted) {
        const local = !navigator.onLine && canPlayLocally()
        setLocalPlay(local)
        setAccount(navigator.onLine || local ? undefined : cachedSession())
      }
    } finally {
      if (!pending.signal.aborted) setChecking(false)
    }
  }, [])

  useEffect(() => {
    const connectivityChanged = () => { void refresh() }
    const visibilityChanged = () => { if (!document.hidden) void refresh() }
    const identityChanged = (event: StorageEvent) => {
      if (event.key !== sessionKey && event.key !== localPlayKey && event.key !== null) return
      setAccount(undefined)
      setLocalPlay(false)
      void refresh()
    }
    window.addEventListener('online', connectivityChanged)
    window.addEventListener('offline', connectivityChanged)
    window.addEventListener('storage', identityChanged)
    document.addEventListener('visibilitychange', visibilityChanged)
    void refresh()
    return () => {
      request.current?.abort()
      window.removeEventListener('online', connectivityChanged)
      window.removeEventListener('offline', connectivityChanged)
      window.removeEventListener('storage', identityChanged)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [refresh])

  useEffect(() => {
    if (!account) return
    const expiry = setTimeout(forget, Math.max(0, validUntil(account) - Date.now()))
    return () => clearTimeout(expiry)
  }, [account, forget])

  return { account, localPlay, checking, online, signIn, refresh, forget }
}
