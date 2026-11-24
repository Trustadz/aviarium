import type { FastifyInstance } from 'fastify'
import { registerLevels } from './levels.js'

/**
 * Quarantined Sudoku Studio/catalog routes from before the platform had generic
 * game endpoints. New clients use /api/games/:game; removing this legacy Studio
 * surface is part of J5.
 */
export function registerLegacySudokuRoutes(app: FastifyInstance) {
  registerLevels(app)
}
