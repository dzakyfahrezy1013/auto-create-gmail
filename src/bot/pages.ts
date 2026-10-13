import type { Page } from 'playwright'
import type { Actor } from './actors.ts'
import type { Persona } from './persona.ts'

/** Each object owns only its step's fields; transitions are checked by the runner. */
export class SignupStep {
  readonly name: string
  readonly fields: Record<string, string>
  constructor(name: string, fields: Record<string, string>) {
    this.name = name
    this.fields = fields
  }
  async submit(page: Page, actor: Actor): Promise<void> {
    await page.locator(`#step-${this.name}`).waitFor()
    for (const [field, value] of Object.entries(this.fields)) {
      if (field === 'month') await actor.select(`#${field}`, value)
      else await actor.type(`#${field}`, value)
    }
    await Promise.all([page.waitForNavigation(), actor.click('#next')])
  }
}

export function signupSteps(p: Persona): SignupStep[] {
  return [
    new SignupStep('name', { firstName: p.firstName, lastName: p.lastName }),
    new SignupStep('birthday', { month: p.month, day: p.day, year: p.year }),
    new SignupStep('username', { username: p.username }),
    new SignupStep('password', { password: p.password, confirm: p.password, phone: p.phone }),
  ]
}
