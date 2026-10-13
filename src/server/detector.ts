import type { Signal, Step, Telemetry } from '../shared/types.ts'

/** Cumulative score at which an attempt is blocked. */
export const BLOCK_THRESHOLD = 70

export interface DetectorConfig {
  /** max accounts created per IP inside `rateWindowMs` */
  rateLimit: number
  rateWindowMs: number
}

/** Text inputs per step whose typing behaviour is inspected. */
export const TYPED_FIELDS: Record<Step, string[]> = {
  name: ['firstName', 'lastName'],
  birthday: ['day', 'year'],
  username: ['username'],
  password: ['password', 'confirm', 'phone'],
  verify: ['code'],
}

export interface StepInput {
  step: Step
  form: Record<string, string>
  telemetry: Telemetry | null
  /** accounts already created from this IP within the rate window */
  recentAccountsFromIp: number
}

/**
 * Pure scoring function: returns the signals raised by one step submission.
 * Each rule mirrors a real-world anti-bot heuristic, kept deliberately simple.
 */
export function detect(input: StepInput, cfg: DetectorConfig): Signal[] {
  const { step, form, telemetry } = input
  const signals: Signal[] = []
  const raise = (rule: string, points: number, detail: string) => signals.push({ rule, points, detail })

  if (step === 'name' && input.recentAccountsFromIp >= cfg.rateLimit) {
    raise(
      'ip_rate_limit',
      100,
      `${input.recentAccountsFromIp} accounts from this IP in the last ${cfg.rateWindowMs / 60000} min (limit ${cfg.rateLimit})`,
    )
  }

  if (form.website) raise('honeypot', 100, 'hidden "website" field was filled — humans never see it')

  if (!telemetry) {
    raise('no_telemetry', 60, 'form posted without the browser telemetry script running (raw HTTP client?)')
    return signals
  }

  if (telemetry.webdriver) raise('webdriver_flag', 40, 'navigator.webdriver === true (automation-controlled browser)')
  if (/HeadlessChrome/i.test(telemetry.userAgent)) raise('headless_ua', 40, 'User-Agent contains "HeadlessChrome"')
  if (telemetry.dwellMs < 1500) raise('too_fast', 20, `step completed in ${telemetry.dwellMs} ms`)
  if (telemetry.pointerMoves === 0) raise('no_pointer', 15, 'no mouse/pointer movement on the page')

  for (const field of TYPED_FIELDS[step]) {
    const value = form[field] ?? ''
    if (!value) continue
    const k = telemetry.keys[field]
    if (!k || k.count < value.length * 0.5) {
      raise('filled_without_typing', 30, `"${field}" has ${value.length} chars but only ${k?.count ?? 0} keydowns`)
    } else if (k.count > 3 && k.meanIntervalMs < 30) {
      raise('inhuman_typing', 25, `"${field}" typed at ${k.meanIntervalMs.toFixed(0)} ms/key`)
    }
  }

  return signals
}
