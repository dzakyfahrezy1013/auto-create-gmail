/** Signup steps, in order. The server enforces this sequence per session. */
export const STEPS = ['name', 'birthday', 'username', 'password', 'verify'] as const
export type Step = (typeof STEPS)[number]

/** Behavioural signals collected in the browser and posted with every form step. */
export interface Telemetry {
  webdriver: boolean
  userAgent: string
  /** ms between page load and submit */
  dwellMs: number
  pointerMoves: number
  /** per input name: keydown count and mean ms between keydowns */
  keys: Record<string, { count: number; meanIntervalMs: number }>
}

export interface Signal {
  rule: string
  points: number
  detail: string
}

export type Outcome = 'in_progress' | 'created' | 'blocked' | 'abandoned'

export interface Attempt {
  id: string
  ip: string
  startedAt: string
  updatedAt: string
  step: Step | 'done'
  outcome: Outcome
  score: number
  signals: Signal[]
  username?: string
}

export interface Account {
  username: string
  passwordHash: string
  firstName: string
  lastName: string
  birthday: string
  phone: string
  createdAt: string
  attemptId: string
}
