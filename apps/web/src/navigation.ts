/**
 * Aviarium keeps one history entry per visible layer. Opening a game from a
 * shortcut (Continue, History, a shared link) lays down the missing selector
 * and menu entries first, so the browser, hardware, and in-app back actions
 * all move up the same hierarchy: game → level selector → game menu → library.
 */
export type StudioLayer = 'pack' | 'trial'

export interface NavigationLayer {
  depth: number
  player?: boolean
  studio?: StudioLayer
  studioPack?: string
}

interface StoredNavigation {
  aviarium?: Partial<NavigationLayer>
}

interface LayerOptions {
  player?: boolean
  studio?: StudioLayer
  studioPack?: string
}

function normalizePath(pathname: string) {
  return pathname.replace(/\/$/, '') || '/'
}

/** The visible in-app layers above a URL, starting with the library. */
export function routeTrail(pathname: string): string[] {
  const path = normalizePath(pathname)
  if (path === '/') return ['/']
  const segments = path.split('/').filter(Boolean)
  if (segments[0] === 'games' && segments[1]) {
    const menu = '/games/' + segments[1]
    return path === menu ? ['/', menu] : ['/', menu, path]
  }
  if (segments[0] === 'studio') {
    if (path === '/studio') return ['/', path]
    if (segments.length === 3 && segments[2] === 'admin') return ['/', '/admin', path]
    return ['/', '/studio', path]
  }
  return ['/', path]
}

export function navigationLayer(state: unknown): NavigationLayer | undefined {
  const layer = state && typeof state === 'object' ? (state as StoredNavigation).aviarium : undefined
  if (!layer || !Number.isInteger(layer.depth) || layer.depth === undefined || layer.depth < 0) return undefined
  const studio = layer.studio === 'pack' || layer.studio === 'trial' ? layer.studio : undefined
  return {
    depth: layer.depth,
    ...(layer.player === true ? { player: true } : {}),
    ...(studio ? { studio } : {}),
    ...(studio && typeof layer.studioPack === 'string' ? { studioPack: layer.studioPack } : {}),
  }
}

function layerState(options: LayerOptions): NavigationLayer {
  return {
    depth: currentDepth() + 1,
    ...(options.player ? { player: true } : {}),
    ...(options.studio ? { studio: options.studio } : {}),
    ...(options.studio && options.studioPack ? { studioPack: options.studioPack } : {}),
  }
}

export function currentDepth(state: unknown = history.state): number {
  return navigationLayer(state)?.depth ?? 0
}

export function canGoBack(state: unknown = history.state): boolean {
  return currentDepth(state) > 0
}

/** Push a new visible layer, never coalescing identical URLs. */
export function pushLayer(url: string, options: LayerOptions = {}): void {
  history.pushState({ aviarium: layerState(options) }, '', url)
}

/** Replace the current screen without adding another back step. */
export function replaceLayer(url: string, options: LayerOptions = {}): void {
  const layer = navigationLayer(history.state)
  history.replaceState({
    aviarium: {
      depth: layer?.depth ?? 0,
      ...(options.player ? { player: true } : {}),
      ...(options.studio ? { studio: options.studio } : {}),
      ...(options.studio && options.studioPack ? { studioPack: options.studioPack } : {}),
    },
  }, '', url)
}

/**
 * Give a directly opened URL its parent layers. Reloads keep the existing
 * stack because every entry Aviarium creates carries a depth marker.
 */
export function seedHistory(pathname: string, search = '', hash = ''): number {
  const existing = navigationLayer(history.state)
  if (existing) return existing.depth
  const trail = routeTrail(pathname)
  history.replaceState({ aviarium: { depth: 0 } }, '',
    trail.length === 1 ? normalizePath(pathname) + search + hash : trail[0])
  for (let index = 1; index < trail.length; index++) {
    const url = index === trail.length - 1 ? normalizePath(pathname) + search + hash : trail[index]
    history.pushState({ aviarium: { depth: index } }, '', url)
  }
  return trail.length - 1
}
