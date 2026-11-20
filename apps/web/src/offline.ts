export async function offlineRequest(operation: 'download-player' | 'player-ready') {
  const worker = navigator.serviceWorker?.controller
  if (!worker) return false
  return new Promise<boolean>(resolve => {
    const { port1, port2 } = new MessageChannel()
    const timeout = setTimeout(() => { port1.close(); resolve(false) }, 20_000)
    port1.onmessage = event => {
      clearTimeout(timeout)
      port1.close()
      resolve(Boolean(event.data.ok))
    }
    worker.postMessage(operation, [port2])
  })
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
