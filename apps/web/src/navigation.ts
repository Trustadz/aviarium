/**
 * Aviarium keeps one history entry per screen the player actually visited.
 * Back pops that history. Only a directly opened URL is seeded with its
 * canonical parents, so a cold launch or shared link still has somewhere to
 * go back to. A game opened from Continue, History, or a leaderboard keeps
 * that screen as its origin instead of inventing a level selector.
 */
export type StudioLayer = 'pack' | 'trial'
/** Where a Studio game screen was opened from, so its exit can name the way back. */
export type StudioOrigin = 'game'

/** The screen a history entry was pushed from. */
export interface ScreenRef {
  path: string
}

export interface NavigationLayer {
  depth: number
  player?: boolean
  from?: ScreenRef
  studio?: StudioLayer
  studioPack?: string
  studioOrigin?: StudioOrigin
}

interface StoredNavigation {
  aviarium?: Partial<NavigationLayer>
}

interface LayerOptions {
  player?: boolean
  from?: ScreenRef
  studio?: StudioLayer
  studioPack?: string
  studioOrigin?: StudioOrigin
}

function normalizePath(pathname: string) {
  return pathname.replace(/\/$/, '') || '/'
}

/** The visible in-app layers above a directly opened URL, starting with the library. */
export function routeTrail(pathname: string): string[] {
  const path = normalizePath(pathname)
  if (path === '/') return ['/']
  const segments = path.split('/').filter(Boolean)
  if (segments[0] === 'games' && segments[1]) {
    const menu = '/games/' + segments[1]
    if (path === menu) return ['/', menu]
    if (segments[2] === 'packs' && segments.length >= 5) {
      const overview = '/games/' + segments[1] + '/packs/' + segments[3] + '/' + segments[4]
      const chapter = segments[5] === 'chapters' && segments[6]
      return chapter ? ['/', menu, overview, path] : ['/', menu, overview]
    }
    if (segments[2] === 'leaderboards') {
      const leaderboards = menu + '/leaderboards'
      return path === leaderboards ? ['/', menu, leaderboards] : ['/', menu, leaderboards, path]
    }
    return ['/', menu, path]
  }
  if (segments[0] === 'challenges') {
    if (path === '/challenges') return ['/', path]
    const day = '/challenges/' + segments[1]
    return path === day ? ['/', '/challenges', path] : ['/', '/challenges', day, path]
  }
  if (segments[0] === 'studio') {
    if (path === '/studio') return ['/', path]
    if (segments.length === 3 && segments[2] === 'admin') return ['/', '/admin', path]
    return ['/', '/studio', path]
  }
  return ['/', path]
}

function screenRef(value: unknown): ScreenRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const path = (value as Partial<ScreenRef>).path
  return typeof path === 'string' && path.startsWith('/') ? { path: normalizePath(path) } : undefined
}

export function navigationLayer(state: unknown): NavigationLayer | undefined {
  const layer = state && typeof state === 'object' ? (state as StoredNavigation).aviarium : undefined
  if (!layer || !Number.isInteger(layer.depth) || layer.depth === undefined || layer.depth < 0) return undefined
  const studio = layer.studio === 'pack' || layer.studio === 'trial' ? layer.studio : undefined
  const from = screenRef(layer.from)
  return {
    depth: layer.depth,
    ...(layer.player === true ? { player: true } : {}),
    ...(from ? { from } : {}),
    ...(studio ? { studio } : {}),
    ...(studio && typeof layer.studioPack === 'string' ? { studioPack: layer.studioPack } : {}),
    ...(layer.studioOrigin === 'game' ? { studioOrigin: 'game' as const } : {}),
  }
}

function layerState(options: LayerOptions): NavigationLayer {
  const origin = options.studioOrigin ?? (options.studio ? navigationLayer(history.state)?.studioOrigin : undefined)
  return {
    depth: currentDepth() + 1,
    ...(options.player ? { player: true } : {}),
    ...(options.from ? { from: options.from } : {}),
    ...(options.studio ? { studio: options.studio } : {}),
    ...(options.studio && options.studioPack ? { studioPack: options.studioPack } : {}),
    ...(origin ? { studioOrigin: origin } : {}),
  }
}

export function currentDepth(state: unknown = history.state): number {
  return navigationLayer(state)?.depth ?? 0
}

export function canGoBack(state: unknown = history.state): boolean {
  return currentDepth(state) > 0
}

/** Push a new visible screen, never coalescing identical URLs. */
export function pushLayer(url: string, options: LayerOptions = {}): void {
  history.pushState({ aviarium: layerState(options) }, '', url)
}

/**
 * Replace the current screen without adding another back step. The current
 * origin is kept unless the caller supplies a new one, so replacing gameplay
 * with its roadmap still returns to where the game was opened from.
 */
export function replaceLayer(url: string, options: LayerOptions = {}): void {
  const layer = navigationLayer(history.state)
  const origin = options.studioOrigin ?? layer?.studioOrigin
  const from = options.from ?? layer?.from
  history.replaceState({
    aviarium: {
      depth: layer?.depth ?? 0,
      ...(options.player ? { player: true } : {}),
      ...(from ? { from } : {}),
      ...(options.studio ? { studio: options.studio } : {}),
      ...(options.studio && options.studioPack ? { studioPack: options.studioPack } : {}),
      ...(origin ? { studioOrigin: origin } : {}),
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
    history.pushState({ aviarium: { depth: index, from: { path: trail[index - 1] } } }, '', url)
  }
  return trail.length - 1
}
