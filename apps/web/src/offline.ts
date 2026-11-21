import { useCallback, useEffect, useRef, useState } from 'react'

async function offlineRequest(worker: ServiceWorker, operation: 'open' | 'touch' | 'remove' | 'check' | 'list', game?: string) {
  return new Promise<string[]>((resolve, reject) => {
    const error = () => new Error('Could not update game downloads on this device.')
    const { port1, port2 } = new MessageChannel()
    const timeout = setTimeout(() => { port1.close(); reject(error()) }, 20_000)
    port1.onmessage = event => {
      clearTimeout(timeout)
      port1.close()
      if (Array.isArray(event.data.games)) resolve(event.data.games)
      else reject(error())
    }
    worker.postMessage({ operation, game }, [port2])
  })
}

export function useGameDownloads(game: string | undefined, online: boolean, enabled = true) {
  const [installed, setInstalled] = useState<string[]>([])
  const opened = useRef<{ game: string; worker: ServiceWorker; installed: boolean } | undefined>(undefined)
  const nextActivity = useRef(new Map<string, number>())
  useEffect(() => {
    const serviceWorker = navigator.serviceWorker
    if (!enabled || !serviceWorker) return
    let current = true
    if (!game) opened.current = undefined
    const update = async (enter = false) => {
      const worker = serviceWorker.controller
      if (!worker) return
      if (game && enter && (opened.current?.game !== game || opened.current.worker !== worker || !opened.current.installed)) {
        const entry = { game, worker, installed: false }
        opened.current = entry
        const games = await offlineRequest(worker, 'open', game).catch(() => undefined)
        entry.installed = games?.includes(game) ?? false
      }
      if (!current) return
      const games = await offlineRequest(worker, online ? 'check' : 'list').catch(() => undefined)
      if (current && games) setInstalled(games)
    }
    const refresh = () => { if (!document.hidden) void update() }
    const controllerChanged = () => { void update(true) }
    void update(true)
    const interval = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    serviceWorker.addEventListener('controllerchange', controllerChanged)
    return () => {
      current = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      serviceWorker.removeEventListener('controllerchange', controllerChanged)
    }
  }, [enabled, game, online])

  const remove = useCallback(async (id: string) => {
    const worker = navigator.serviceWorker?.controller
    if (worker) setInstalled(await offlineRequest(worker, 'remove', id))
  }, [])
  const recordActivity = useCallback((id: string) => {
    const worker = navigator.serviceWorker?.controller
    if (!worker || Date.now() < (nextActivity.current.get(id) ?? 0)) return
    nextActivity.current.set(id, Date.now() + 60 * 60 * 1000)
    void offlineRequest(worker, 'touch', id).catch(() => { nextActivity.current.delete(id) })
  }, [])
  return { installed, remove, recordActivity }
}

export async function registerOffline(onUpdate: (activate: () => void) => void) {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.register('/sw.js')
  const announce = () => {
    if (!registration.waiting || !navigator.serviceWorker.controller) return
    onUpdate(() => {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
      registration.waiting?.postMessage('activate')
    })
  }
  announce()
  registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', announce))
}
