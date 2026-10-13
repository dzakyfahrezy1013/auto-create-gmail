import { createHash, randomBytes, randomInt } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { STEPS, type Attempt, type Step, type Telemetry } from '../shared/types.ts'
import { BLOCK_THRESHOLD, detect, type DetectorConfig } from './detector.ts'
import { Store } from './store.ts'
import { adminPage, blockedPage, donePage, inboxPage, stepPage } from './views.ts'

const PORT = Number(process.env.PORT ?? 3000)
const cfg: DetectorConfig = {
  rateLimit: Number(process.env.RATE_LIMIT ?? 3),
  rateWindowMs: Number(process.env.RATE_WINDOW_MIN ?? 10) * 60_000,
}
const store = new Store(join(import.meta.dirname, '..', '..', 'data', 'db.json'))

const COOKIE = 'lab_sid'
const USERNAME_RE = /^[a-z0-9.]{6,30}$/

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers })
  res.end(body)
}

function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
  res.writeHead(303, { location, ...headers })
  res.end()
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 64_000) throw new Error('body too large')
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

function sessionId(req: IncomingMessage): string | undefined {
  return req.headers.cookie?.match(new RegExp(`${COOKIE}=([a-f0-9]+)`))?.[1]
}

/** Client IP; honours X-Forwarded-For only from loopback so the lab can simulate many IPs. */
function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? 'unknown'
  const fwd = req.headers['x-forwarded-for']
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  return loopback && typeof fwd === 'string' && fwd ? fwd.split(',')[0].trim() : remote
}

function parseTelemetry(raw: string | undefined): Telemetry | null {
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as Telemetry
    return typeof t.dwellMs === 'number' && typeof t.keys === 'object' ? t : null
  } catch {
    return null
  }
}

/** Validates step fields and stores them on the draft. Returns a user-facing error, if any. */
function applyStep(step: Step, form: Record<string, string>, sid: string, attempt: Attempt): string | undefined {
  const draft = store.drafts.get(sid) ?? {}
  store.drafts.set(sid, draft)

  switch (step) {
    case 'name':
      if (!form.firstName?.trim() || !form.lastName?.trim()) return 'Enter first and last name'
      draft.firstName = form.firstName.trim()
      draft.lastName = form.lastName.trim()
      return
    case 'birthday': {
      const m = Number(form.month), d = Number(form.day), y = Number(form.year)
      const date = new Date(Date.UTC(y, m - 1, d))
      if (!(m >= 1 && m <= 12) || date.getUTCDate() !== d || y < 1900) return 'Enter a valid date'
      if (new Date().getUTCFullYear() - y < 13) return 'You must be at least 13'
      draft.birthday = date.toISOString().slice(0, 10)
      return
    }
    case 'username': {
      const u = (form.username ?? '').toLowerCase()
      if (!USERNAME_RE.test(u)) return 'Use 6–30 letters, numbers or dots'
      if (store.accounts.has(u)) return 'That username is taken'
      draft.username = u
      attempt.username = u
      return
    }
    case 'password': {
      if ((form.password ?? '').length < 8) return 'Use 8 characters or more'
      if (form.password !== form.confirm) return "Those passwords didn't match"
      if (!/^\+?[0-9]{8,15}$/.test(form.phone ?? '')) return 'Enter a valid phone number'
      const phoneUses = [...store.accounts.values()].filter((a) => a.phone === form.phone).length
      if (phoneUses >= 2) return 'This phone number has been used too many times'
      draft.passwordHash = createHash('sha256').update(form.password).digest('hex')
      draft.phone = form.phone
      draft.code = String(randomInt(100000, 1000000))
      store.sms.push({ phone: form.phone, body: `LabMail code: ${draft.code}`, sentAt: new Date().toISOString() })
      return
    }
    case 'verify': {
      if (form.code !== draft.code) return 'Wrong code. Try again.'
      const username = draft.username as string
      if (store.accounts.has(username)) return 'That username is taken'
      store.accounts.set(username, {
        username,
        passwordHash: draft.passwordHash as string,
        firstName: draft.firstName as string,
        lastName: draft.lastName as string,
        birthday: draft.birthday as string,
        phone: draft.phone as string,
        createdAt: new Date().toISOString(),
        attemptId: attempt.id,
      })
      store.drafts.delete(sid)
      return
    }
  }
}

async function handleStepPost(req: IncomingMessage, res: ServerResponse, step: Step): Promise<void> {
  const sid = sessionId(req)
  const attempt = sid ? store.attempts.get(sid) : undefined
  if (!sid || !attempt || attempt.outcome !== 'in_progress') return redirect(res, '/')
  if (attempt.step !== step) return redirect(res, `/signup/${attempt.step}`)

  const form = await readForm(req)
  const ip = clientIp(req)
  const signals = detect(
    {
      step,
      form,
      telemetry: parseTelemetry(form.telemetry),
      recentAccountsFromIp: store.accountsFromIpSince(ip, Date.now() - cfg.rateWindowMs),
    },
    cfg,
  )
  // A rule counts once per attempt, so repeating the same mistake doesn't inflate the score.
  for (const s of signals) {
    if (attempt.signals.some((x) => x.rule === s.rule)) continue
    attempt.signals.push(s)
    attempt.score += s.points
  }
  attempt.updatedAt = new Date().toISOString()

  if (attempt.score >= BLOCK_THRESHOLD) {
    attempt.outcome = 'blocked'
    store.drafts.delete(sid)
    store.save()
    return send(res, 403, blockedPage(attempt))
  }

  const error = applyStep(step, form, sid, attempt)
  if (error) {
    store.save()
    return send(res, 422, stepPage(step, error))
  }

  const next = STEPS[STEPS.indexOf(step) + 1]
  if (next) {
    attempt.step = next
    store.save()
    return redirect(res, `/signup/${next}`)
  }
  attempt.step = 'done'
  attempt.outcome = 'created'
  store.save()
  send(res, 200, donePage(attempt.username as string))
}

function startAttempt(req: IncomingMessage, res: ServerResponse): void {
  const sid = sessionId(req)
  const prev = sid ? store.attempts.get(sid) : undefined
  if (prev?.outcome === 'in_progress') prev.outcome = 'abandoned'

  const id = randomBytes(12).toString('hex')
  const now = new Date().toISOString()
  store.attempts.set(id, { id, ip: clientIp(req), startedAt: now, updatedAt: now, step: 'name', outcome: 'in_progress', score: 0, signals: [] })
  store.save()
  redirect(res, '/signup/name', { 'set-cookie': `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax` })
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  if (req.method === 'GET' && path === '/') return startAttempt(req, res)

  const stepMatch = path.match(/^\/signup\/([a-z]+)$/)
  const step = STEPS.find((s) => s === stepMatch?.[1])
  if (step) {
    if (req.method === 'POST') return handleStepPost(req, res, step)
    const attempt = store.attempts.get(sessionId(req) ?? '')
    if (!attempt || attempt.outcome !== 'in_progress') return redirect(res, '/')
    if (attempt.step !== step) return redirect(res, `/signup/${attempt.step}`)
    return send(res, 200, stepPage(step))
  }

  if (req.method === 'GET' && path === '/inbox') return send(res, 200, inboxPage(store.sms))
  if (req.method === 'GET' && path === '/api/inbox') {
    const phone = url.searchParams.get('phone')
    const msgs = store.sms.filter((m) => m.phone === phone)
    return send(res, 200, JSON.stringify(msgs), { 'content-type': 'application/json' })
  }
  if (req.method === 'GET' && path === '/admin') {
    return send(res, 200, adminPage([...store.attempts.values()], [...store.accounts.values()]))
  }
  if (req.method === 'GET' && path === '/api/attempts') {
    return send(res, 200, JSON.stringify([...store.attempts.values()]), { 'content-type': 'application/json' })
  }
  if (req.method === 'POST' && path === '/admin/reset') {
    store.reset()
    return redirect(res, '/admin')
  }
  send(res, 404, 'Not found', { 'content-type': 'text/plain' })
}

createServer((req, res) => {
  route(req, res).catch((err: Error) => {
    console.error(err)
    if (!res.headersSent) send(res, 500, 'Internal error', { 'content-type': 'text/plain' })
  })
}).listen(PORT, '127.0.0.1', () => {
  console.log(`LabMail mock signup on http://localhost:${PORT}  (dashboard: /admin, SMS inbox: /inbox)`)
  console.log(`rate limit: ${cfg.rateLimit} accounts / IP / ${cfg.rateWindowMs / 60000} min · block threshold ${BLOCK_THRESHOLD}`)
})
