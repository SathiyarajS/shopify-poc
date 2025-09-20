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
      console.error('globalThis.DB:', globalThis.DB)
      console.error('globalThis.env:', globalThis.env)
      throw new Error('D1 database binding not found')
    }
    console.log('Creating Prisma client with D1 adapter')
    const adapter = new PrismaD1(database)
    return new PrismaClient({ 
      adapter,
      log: ['error', 'warn']
    })
  } else {
    // Use regular SQLite for local development
    console.log('Creating Prisma client for local development')
    return new PrismaClient({
      log: ['error', 'warn']
    })
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
