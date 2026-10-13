import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Account, Attempt } from '../shared/types.ts'

export interface Draft {
  firstName?: string
  lastName?: string
  birthday?: string
  username?: string
  passwordHash?: string
  phone?: string
  code?: string
}

export interface SmsMessage {
  phone: string
  body: string
  sentAt: string
}

interface Persisted {
  attempts: Attempt[]
  accounts: Account[]
  sms: SmsMessage[]
}

/** In-memory state, persisted to a JSON file so the dashboard survives restarts. */
export class Store {
  readonly attempts = new Map<string, Attempt>()
  readonly drafts = new Map<string, Draft>()
  readonly accounts = new Map<string, Account>()
  sms: SmsMessage[] = []
  private readonly file: string

  constructor(file: string) {
    this.file = file
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Persisted
      for (const a of data.attempts) this.attempts.set(a.id, a)
      for (const a of data.accounts) this.accounts.set(a.username, a)
      this.sms = data.sms
    } catch {
      // first run: no file yet
    }
  }

  save(): void {
    const data: Persisted = {
      attempts: [...this.attempts.values()],
      accounts: [...this.accounts.values()],
      sms: this.sms,
    }
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(data, null, 2))
  }

  reset(): void {
    this.attempts.clear()
    this.drafts.clear()
    this.accounts.clear()
    this.sms = []
    this.save()
  }

  accountsFromIpSince(ip: string, sinceMs: number): number {
    let n = 0
    for (const a of this.attempts.values()) {
      if (a.ip === ip && a.outcome === 'created' && Date.parse(a.updatedAt) >= sinceMs) n++
    }
    return n
  }
}
