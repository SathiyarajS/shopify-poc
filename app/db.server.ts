import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'

let db: PrismaClient | null = null

declare global {
  var __db__: PrismaClient | null
}

// Check if we're in Cloudflare Workers environment
function isCloudflareWorkers() {
  return typeof globalThis.DB !== 'undefined' || typeof globalThis.env?.DB !== 'undefined'
}

// Create Prisma client based on environment
function createPrismaClient() {
  if (isCloudflareWorkers()) {
    // Use D1 adapter in Cloudflare Workers
    const database = globalThis.DB || globalThis.env?.DB
    if (!database) {
      console.error('D1 database binding not found. Make sure DB is bound in wrangler.toml')
      throw new Error('D1 database binding not found')
    }
    const adapter = new PrismaD1(database)
    return new PrismaClient({ adapter })
  } else {
    // Use regular SQLite for local development
    return new PrismaClient()
  }
}

// Get database instance - lazy initialization
export function getDatabase(): PrismaClient {
  if (process.env.NODE_ENV === 'production') {
    if (!db) {
      db = createPrismaClient()
    }
    return db
  } else {
    if (!global.__db__) {
      global.__db__ = createPrismaClient()
    }
    return global.__db__
  }
}

export default getDatabase
