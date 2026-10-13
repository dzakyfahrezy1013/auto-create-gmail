import { chromium } from 'playwright'
import { HumanActor, NaiveActor } from './actors.ts'
import { makePersona } from './persona.ts'
import { SignupStep, signupSteps } from './pages.ts'

const args = process.argv.slice(2)
const mode = args.includes('--human') ? 'human' : 'naive'
const countArg = args.indexOf('--count')
const count = countArg < 0 ? 1 : Number(args[countArg + 1])
if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('--count must be 1–20')
const base = new URL(process.env.LAB_URL ?? 'http://127.0.0.1:3000')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password) {
  throw new Error('This lab runner only accepts http://127.0.0.1')
}
const browser = await chromium.launch({ headless: mode === 'naive' && !args.includes('--headed') })
let failures = 0
try {
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext()
    // Every request, including redirects, is restricted to the local lab.
    await context.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== base.origin) await route.abort()
      else await route.continue()
    })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      const actor = mode === 'human' ? new HumanActor(page) : new NaiveActor(page)
      const persona = makePersona()
      await page.goto(base.href)
      for (const step of signupSteps(persona)) {
        await step.submit(page, actor)
        if (await page.locator('#blocked').count()) break
        const error = page.locator('[role=alert]')
        if (await error.count()) throw new Error(await error.innerText())
      }
      if (!await page.locator('#blocked').count()) {
        const response = await context.request.get(new URL(`/api/inbox?phone=${encodeURIComponent(persona.phone)}`, base).href)
        const messages = await response.json() as { body: string }[]
        const code = messages.at(-1)?.body.match(/\d{6}$/)?.[0]
        if (!code) throw new Error('Mock SMS code missing')
        await new SignupStep('verify', { code }).submit(page, actor)
      }
      if (await page.locator('#blocked').count()) {
        console.log(`[${i + 1}/${count}] ${mode}: BLOCKED — ${await page.locator('.sub').innerText()}`)
      } else if (await page.locator('#welcome').count()) {
        console.log(`[${i + 1}/${count}] ${mode}: CREATED ${persona.username}@labmail.test`)
      } else throw new Error(`Unexpected signup state: ${page.url()}`)
    } catch (error) {
      failures++
      console.error(`[${i + 1}/${count}] ERROR`, error)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
if (failures) process.exitCode = 1
