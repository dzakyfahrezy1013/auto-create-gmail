import type { Account, Attempt, Step } from '../shared/types.ts'
import type { SmsMessage } from './store.ts'
import { BLOCK_THRESHOLD } from './detector.ts'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const CSS = `
body{font-family:system-ui,sans-serif;background:#f1f3f4;margin:0;color:#202124}
.card{max-width:420px;margin:48px auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px #0003}
.wide{max-width:1100px}
h1{font-weight:400;font-size:24px;margin:0 0 4px}p.sub{color:#5f6368;margin:0 0 24px}
label{display:block;font-size:13px;color:#5f6368;margin:12px 0 4px}
input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #dadce0;border-radius:4px;font-size:15px}
button{margin-top:24px;background:#1a73e8;color:#fff;border:0;border-radius:4px;padding:10px 24px;font-size:14px;cursor:pointer}
.err{color:#d93025;font-size:13px;margin-top:8px}
.hp{position:absolute;left:-9999px}
table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #eee;padding:6px;text-align:left;vertical-align:top}
.created{color:#188038}.blocked{color:#d93025}.in_progress{color:#e37400}.abandoned{color:#5f6368}
code{background:#f1f3f4;padding:1px 4px;border-radius:3px}
nav a{margin-right:16px}
`

/**
 * Client-side telemetry: counts pointer moves and per-field keydown timing,
 * then serialises it into a hidden input right before submit.
 */
const TELEMETRY_JS = `
(() => {
  const t0 = performance.now(); let moves = 0; const keys = {};
  addEventListener('pointermove', () => moves++, { passive: true });
  document.querySelectorAll('input').forEach((el) => {
    el.addEventListener('keydown', () => {
      const k = keys[el.name] ??= { count: 0, last: 0, total: 0 };
      const now = performance.now();
      if (k.count > 0) k.total += now - k.last;
      k.last = now; k.count++;
    });
  });
  document.querySelector('form').addEventListener('submit', () => {
    const out = {};
    for (const [name, k] of Object.entries(keys))
      out[name] = { count: k.count, meanIntervalMs: k.count > 1 ? k.total / (k.count - 1) : 0 };
    document.querySelector('input[name=telemetry]').value = JSON.stringify({
      webdriver: navigator.webdriver === true,
      userAgent: navigator.userAgent,
      dwellMs: Math.round(performance.now() - t0),
      pointerMoves: moves,
      keys: out,
    });
  });
})();
`

function layout(title: string, body: string, wide = false): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="card${wide ? ' wide' : ''}">${body}</div></body></html>`
}

const field = (name: string, label: string, type = 'text', value = '') =>
  `<label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" autocomplete="off">`

const STEP_FORMS: Record<Step, { title: string; sub: string; fields: string }> = {
  name: {
    title: 'Create a LabMail Account',
    sub: 'Enter your name',
    fields: field('firstName', 'First name') + field('lastName', 'Last name'),
  },
  birthday: {
    title: 'Basic information',
    sub: 'Enter your birthday',
    fields: `<label for="month">Month</label><select id="month" name="month"><option value="">Month</option>${[
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ]
      .map((m, i) => `<option value="${i + 1}">${m}</option>`)
      .join('')}</select>${field('day', 'Day', 'tel')}${field('year', 'Year', 'tel')}`,
  },
  username: {
    title: 'Choose your address',
    sub: 'Pick a username for @labmail.test',
    fields: field('username', 'Username'),
  },
  password: {
    title: 'Create a strong password',
    sub: 'Use 8 or more characters, then add a phone for verification',
    fields: field('password', 'Password', 'password') + field('confirm', 'Confirm', 'password') + field('phone', 'Phone number', 'tel'),
  },
  verify: {
    title: 'Verify your phone',
    sub: 'Enter the 6-digit code we sent (see the Lab SMS inbox)',
    fields: field('code', 'Code', 'tel'),
  },
}

export function stepPage(step: Step, error?: string): string {
  const f = STEP_FORMS[step]
  return layout(
    f.title,
    `<h1>${f.title}</h1><p class="sub">${f.sub}</p>
<form method="post" action="/signup/${step}" id="step-${step}">
${f.fields}
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<input type="hidden" name="telemetry">
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
<button type="submit" id="next">Next</button>
</form><script>${TELEMETRY_JS}</script>`,
  )
}

export function donePage(username: string): string {
  return layout('Welcome', `<h1 id="welcome">Welcome, ${esc(username)}@labmail.test</h1><p class="sub">Account created.</p><a href="/">Start over</a>`)
}

export function blockedPage(attempt: Attempt): string {
  return layout(
    'Blocked',
    `<h1 id="blocked">Sorry, we could not create your account.</h1>
<p class="sub">Risk score ${attempt.score} ≥ ${BLOCK_THRESHOLD}. (A real site would never tell you why — the lab does.)</p>
<ul>${attempt.signals.map((s) => `<li><code>${s.rule}</code> +${s.points} — ${esc(s.detail)}</li>`).join('')}</ul>
<a href="/">Start over</a>`,
  )
}

export function inboxPage(sms: SmsMessage[]): string {
  const rows = sms
    .slice()
    .reverse()
    .map((m) => `<tr><td>${esc(m.sentAt)}</td><td>${esc(m.phone)}</td><td>${esc(m.body)}</td></tr>`)
    .join('')
  return layout(
    'Lab SMS inbox',
    `<nav><a href="/">Signup</a><a href="/admin">Dashboard</a></nav><h1>Lab SMS inbox</h1>
<p class="sub">Simulated SMS gateway: every verification code "sent" by the site lands here.</p>
<table><tr><th>Sent</th><th>Phone</th><th>Message</th></tr>${rows}</table>`,
    true,
  )
}

export function adminPage(attempts: Attempt[], accounts: Account[]): string {
  const count = (o: string) => attempts.filter((a) => a.outcome === o).length
  const ruleHits = new Map<string, number>()
  for (const a of attempts) for (const s of a.signals) ruleHits.set(s.rule, (ruleHits.get(s.rule) ?? 0) + 1)

  const rows = attempts
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(
      (a) => `<tr><td>${esc(a.startedAt.slice(11, 19))}</td><td>${esc(a.ip)}</td><td>${a.step}</td>
<td class="${a.outcome}">${a.outcome}</td><td>${a.score}</td><td>${esc(a.username ?? '')}</td>
<td>${a.signals.map((s) => `<code title="${esc(s.detail)}">${s.rule}+${s.points}</code>`).join(' ')}</td></tr>`,
    )
    .join('')

  return layout(
    'Lab dashboard',
    `<nav><a href="/">Signup</a><a href="/inbox">SMS inbox</a></nav>
<h1>Anti-bot dashboard</h1>
<p class="sub">Attempts: ${attempts.length} · <span class="created">created ${count('created')}</span> ·
<span class="blocked">blocked ${count('blocked')}</span> · <span class="in_progress">in progress ${count('in_progress')}</span> ·
accounts stored ${accounts.length} · block threshold ${BLOCK_THRESHOLD}</p>
<p>Rule hits: ${[...ruleHits].map(([r, n]) => `<code>${r}</code>×${n}`).join(' ') || '—'}</p>
<form method="post" action="/admin/reset"><button>Reset lab data</button></form>
<table><tr><th>Start</th><th>IP</th><th>Step</th><th>Outcome</th><th>Score</th><th>Username</th><th>Signals (hover for detail)</th></tr>${rows}</table>`,
    true,
  )
}
