import { randomBytes, randomInt } from 'node:crypto'

const FIRST = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hadi', 'Intan', 'Joko', 'Kirana', 'Lestari', 'Maya', 'Nanda', 'Putri', 'Rizky', 'Sari', 'Taufik', 'Wulan', 'Yoga']
const LAST = ['Pratama', 'Saputra', 'Wijaya', 'Santoso', 'Hidayat', 'Kurniawan', 'Lubis', 'Nasution', 'Siregar', 'Gunawan', 'Halim', 'Setiawan']

export interface Persona {
  firstName: string
  lastName: string
  month: string
  day: string
  year: string
  username: string
  password: string
  phone: string
}

/** Fake identity for the lab site. Phone numbers use the 0000 prefix so they are obviously not real. */
export function makePersona(): Persona {
  const firstName = FIRST[randomInt(FIRST.length)]
  const lastName = LAST[randomInt(LAST.length)]
  return {
    firstName,
    lastName,
    month: String(randomInt(1, 13)),
    day: String(randomInt(1, 29)),
    year: String(randomInt(1975, 2006)),
    username: `${firstName}.${lastName}.${randomBytes(2).toString('hex')}`.toLowerCase(),
    password: randomBytes(9).toString('base64url'),
    phone: `+0000${randomInt(10_000_000, 100_000_000)}`,
  }
}
