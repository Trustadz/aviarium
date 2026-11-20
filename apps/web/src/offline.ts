import { useCallback, useEffect, useState } from 'react'

async function offlineRequest(worker: ServiceWorker, operation: 'open' | 'remove' | 'check' | 'list', game?: string) {
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
  useEffect(() => {
    const serviceWorker = navigator.serviceWorker
    if (!enabled || !serviceWorker) return
    let current = true
    const update = async () => {
      const worker = serviceWorker.controller
      if (!worker) return
      if (game) await offlineRequest(worker, 'open', game).catch(() => undefined)
      if (!current) return
      const games = await offlineRequest(worker, online ? 'check' : 'list').catch(() => undefined)
      if (current && games) setInstalled(games)
    }
    const refresh = () => { if (!document.hidden) void update() }
    void update()
    const interval = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    serviceWorker.addEventListener('controllerchange', refresh)
    return () => {
      current = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
      serviceWorker.removeEventListener('controllerchange', refresh)
    }
  }, [enabled, game, online])

  const remove = useCallback(async (id: string) => {
    const worker = navigator.serviceWorker?.controller
    if (worker) setInstalled(await offlineRequest(worker, 'remove', id))
  }, [])
  return { installed, remove }
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
