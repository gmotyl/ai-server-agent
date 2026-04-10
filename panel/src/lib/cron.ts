const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function parseCron(expr: string) {
  const p = expr.split(/\s+/)
  return {
    minute: parseInt(p[0]) || 0,
    hour: parseInt(p[1]) || 0,
    days: p[4] === '*'
      ? [1, 2, 3, 4, 5, 6, 7]
      : p[4].split(',').map(Number).filter(d => d >= 1 && d <= 7),
  }
}

export function buildCron(min: number, hour: number, days: number[]): string {
  return `${min} ${hour} * * ${days.length === 7 ? '*' : days.join(',')}`
}

export function cronToHuman(expr: string): string {
  const c = parseCron(expr)
  const time = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`
  if (c.days.length === 7) return `Daily at ${time}`
  if (c.days.length === 5 && c.days.join(',') === '1,2,3,4,5') return `Weekdays at ${time}`
  if (c.days.length === 2 && c.days.join(',') === '6,7') return `Weekends at ${time}`
  return `${c.days.map(d => DAYS[d - 1]).join(', ')} at ${time}`
}

export function getDayLabel(days: number[]): string {
  if (days.length === 7) return 'Every day'
  if (days.length === 5 && days.join(',') === '1,2,3,4,5') return 'Weekdays'
  if (days.length === 2 && days.join(',') === '6,7') return 'Weekends'
  if (days.length === 0) return 'No days'
  return days.map(d => DAYS[d - 1]).join(', ')
}
