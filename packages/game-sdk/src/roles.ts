export const accountRoles = ['user', 'editor', 'admin'] as const
export type AccountRole = typeof accountRoles[number]

export function canEditGames(role?: AccountRole) {
  return role === 'editor' || role === 'admin'
}
