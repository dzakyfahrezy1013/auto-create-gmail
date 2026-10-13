import type { Page } from 'playwright'

/** How the bot interacts with the page. Page objects only talk to this interface. */
export interface Actor {
  type(selector: string, text: string): Promise<void>
  select(selector: string, value: string): Promise<void>
  click(selector: string): Promise<void>
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/** Typical scripted bot: sets values directly, no input events, no delays. */
export class NaiveActor implements Actor {
  readonly page: Page
  constructor(page: Page) {
    this.page = page
  }
  async type(selector: string, text: string) {
    await this.page.fill(selector, text)
  }
  async select(selector: string, value: string) {
    await this.page.selectOption(selector, value)
  }
  async click(selector: string) {
    await this.page.click(selector)
  }
}

/**
 * Emulates human input: pointer travels to the element, real keydown events with
 * jittered delays, and reading pauses between fields.
 */
export class HumanActor implements Actor {
  readonly page: Page
  constructor(page: Page) {
    this.page = page
  }

  private async moveTo(selector: string) {
    const box = await this.page.locator(selector).boundingBox()
    if (!box) throw new Error(`element not visible: ${selector}`)
    await this.page.mouse.move(
      box.x + box.width * rand(0.2, 0.8),
      box.y + box.height * rand(0.3, 0.7),
      { steps: Math.round(rand(8, 20)) },
    )
    await this.page.waitForTimeout(rand(80, 250))
  }

  async type(selector: string, text: string) {
    await this.click(selector)
    for (const ch of text) {
      await this.page.keyboard.type(ch)
      await this.page.waitForTimeout(rand(60, 170))
    }
    await this.page.waitForTimeout(rand(250, 700))
  }

  async select(selector: string, value: string) {
    await this.moveTo(selector)
    await this.page.selectOption(selector, value)
    await this.page.waitForTimeout(rand(200, 500))
  }

  async click(selector: string) {
    await this.moveTo(selector)
    await this.page.mouse.down()
    await this.page.waitForTimeout(rand(40, 120))
    await this.page.mouse.up()
  }
}
