// DEMO AUTH ONLY. Password is "123" for every seeded user and the token is just
// base64url(userId). Enough to make sign-in feel real; NOT production auth.
import type { NextFunction, Request, Response } from 'express'
import type { Person } from './types.js'
import { db } from './db.js'

export function makeToken(userId: string): string {
  return Buffer.from(userId).toString('base64url')
}

/** Resolve a login by username + password, or by userId (demo shortcut). */
export function resolveLogin(input: {
  username?: string
  password?: string
  userId?: string
}): Person | null {
  if (input.userId) {
    return db.people.find((p) => p.id === input.userId) ?? null
  }
  if (input.username) {
    const p = db.people.find(
      (x) => x.username.toLowerCase() === input.username!.trim().toLowerCase(),
    )
    if (!p) return null
    return p.password === (input.password ?? '') ? p : null
  }
  return null
}

function readToken(token: string): Person | null {
  try {
    const id = Buffer.from(token, 'base64url').toString('utf8')
    return db.people.find((p) => p.id === id) ?? null
  } catch {
    return null
  }
}

export interface AuthedRequest extends Request {
  user?: Person
}

export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.header('authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '')
  const user = token ? readToken(token) : null
  if (!user) return res.status(401).json({ error: 'not signed in' })
  req.user = user
  next()
}

export function requireRole(...roles: Person['role'][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: `requires role: ${roles.join(' or ')}` })
    next()
  }
}
