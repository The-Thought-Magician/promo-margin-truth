import { CronExpressionParser } from 'cron-parser'

// ---------------------------------------------------------------------------
// PromoMarginTruth scheduling engine.
//
// Pure, deterministic, self-contained functions used by route handlers. No
// external services, no DB access. Schedules come in three "kinds":
//   - 'cron'   : a standard 5/6-field cron expression, evaluated in a timezone
//   - 'rate'   : "every N minutes|hours|days", computed arithmetically
//   - 'oneoff' : a single ISO instant
//
// All instants returned are ISO 8601 UTC strings (suffix 'Z').
// ---------------------------------------------------------------------------

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface Job {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MIN_MS = 60_000

// ---------------------------------------------------------------------------
// Rate-expression parsing: "every N minutes|hours|days"
// ---------------------------------------------------------------------------

interface RateSpec {
  n: number
  unit: 'minutes' | 'hours' | 'days'
  ms: number
}

function parseRate(expr: string): RateSpec | null {
  const m = expr
    .trim()
    .toLowerCase()
    .match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const raw = m[2]
  if (raw.startsWith('minute')) return { n, unit: 'minutes', ms: n * MIN_MS }
  if (raw.startsWith('hour')) return { n, unit: 'hours', ms: n * HOUR_MS }
  return { n, unit: 'days', ms: n * DAY_MS }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(
  kind: ScheduleKind,
  expr: string,
): { valid: boolean; error?: string } {
  if (!expr || !expr.trim()) return { valid: false, error: 'Expression is empty' }
  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(expr)
      return { valid: true }
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
    return { valid: true }
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return { valid: false, error: 'One-off must be a valid ISO instant' }
    return { valid: true }
  }
  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression — human-readable summary
// ---------------------------------------------------------------------------

export function describeExpression(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
): string {
  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return 'Invalid rate expression'
    const unit = r.n === 1 ? r.unit.replace(/s$/, '') : r.unit
    return `Every ${r.n} ${unit}`
  }
  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return 'Invalid one-off instant'
    return `Once at ${new Date(t).toISOString()}`
  }
  // cron
  const parts = expr.trim().split(/\s+/)
  if (parts.length < 5) return 'Invalid cron expression'
  const [min, hour, dom, mon, dow] = parts
  const segs: string[] = []
  if (min === '*' && hour === '*') segs.push('every minute')
  else if (min !== '*' && hour === '*') segs.push(`at minute ${min} of every hour`)
  else if (min === '0' && hour !== '*') segs.push(`at ${hour}:00`)
  else segs.push(`at ${hour}:${min.padStart(2, '0')}`)
  if (dom !== '*') segs.push(`on day-of-month ${dom}`)
  if (mon !== '*') segs.push(`in month ${mon}`)
  if (dow !== '*') segs.push(`on weekday ${dow}`)
  return `${segs.join(', ')} (${timezone})`
}

// ---------------------------------------------------------------------------
// nextFirings — next `count` instants at or after fromISO, as ISO UTC strings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 10,
): string[] {
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime())) return []
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  if (kind === 'oneoff') {
    const t = Date.parse(expr)
    if (Number.isNaN(t)) return []
    return t > from.getTime() ? [new Date(t).toISOString()] : []
  }

  if (kind === 'rate') {
    const r = parseRate(expr)
    if (!r) return []
    const out: string[] = []
    let cursor = from.getTime() + r.ms
    for (let i = 0; i < n; i++) {
      out.push(new Date(cursor).toISOString())
      cursor += r.ms
    }
    return out
  }

  // cron
  const tz = timezone && isValidTimezone(timezone) ? timezone : 'UTC'
  try {
    const it = CronExpressionParser.parse(expr, { tz, currentDate: from })
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const next = it.next()
      out.push(new Date(next.getTime()).toISOString())
    }
    return out
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// loadHeatmap — bucket firing counts across all jobs over the horizon
// ---------------------------------------------------------------------------

export interface HeatmapBucket {
  bucket: string
  count: number
}

export function loadHeatmap(
  jobs: Job[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromMs = Date.now()
  const toMs = fromMs + horizonDays * DAY_MS
  const fromISO = new Date(fromMs).toISOString()
  const counts = new Map<string, number>()

  for (const job of jobs) {
    // generous count so the horizon is densely covered, then filter by window
    const fires = nextFirings(job.kind, job.expr, job.timezone, fromISO, 2000)
    for (const iso of fires) {
      const t = Date.parse(iso)
      if (t > toMs) break
      // hour bucket
      const bucket = iso.slice(0, 13) + ':00:00Z'
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// computeCollisions — minutes where concurrency >= threshold OR >=2 jobs
// share a resource
// ---------------------------------------------------------------------------

export interface Collision {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export function computeCollisions(
  jobs: Job[],
  opts: { horizonDays?: number; threshold?: number } = {},
): Collision[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = Math.max(2, opts.threshold ?? 2)
  const fromMs = Date.now()
  const toMs = fromMs + horizonDays * DAY_MS
  const fromISO = new Date(fromMs).toISOString()

  // minute-bucket -> jobIds
  const byMinute = new Map<string, string[]>()
  const jobResource = new Map<string, string | undefined>()
  for (const job of jobs) jobResource.set(job.id, job.resourceId)

  for (const job of jobs) {
    const fires = nextFirings(job.kind, job.expr, job.timezone, fromISO, 2000)
    for (const iso of fires) {
      const t = Date.parse(iso)
      if (t > toMs) break
      const minute = iso.slice(0, 16) + ':00Z'
      const arr = byMinute.get(minute) ?? []
      arr.push(job.id)
      byMinute.set(minute, arr)
    }
  }

  const out: Collision[] = []
  for (const [minute, jobIds] of byMinute) {
    const concurrency = jobIds.length
    // resource sharing within this minute
    const resourceGroups = new Map<string, string[]>()
    for (const id of jobIds) {
      const rid = jobResource.get(id)
      if (rid) {
        const g = resourceGroups.get(rid) ?? []
        g.push(id)
        resourceGroups.set(rid, g)
      }
    }
    const sharedResource = Array.from(resourceGroups.entries()).find(
      ([, ids]) => ids.length >= 2,
    )

    const concurrencyHit = concurrency >= threshold
    if (!concurrencyHit && !sharedResource) continue

    const start = Date.parse(minute)
    const severity: Collision['severity'] =
      concurrency >= threshold * 2 ? 'high' : concurrency >= threshold ? 'medium' : 'low'

    out.push({
      windowStart: minute,
      windowEnd: new Date(start + MIN_MS).toISOString(),
      jobIds: [...new Set(jobIds)],
      severity: sharedResource && !concurrencyHit ? 'medium' : severity,
      resourceId: sharedResource ? sharedResource[0] : undefined,
    })
  }

  return out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
}

// ---------------------------------------------------------------------------
// dstTraps — detect double-fire / skip / ambiguous windows caused by DST
// offset transitions in the timezone over the next `days`.
// ---------------------------------------------------------------------------

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Offset (minutes) such that local = utc + offset.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  let hour = parseInt(map.hour, 10)
  if (hour === 24) hour = 0
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    hour,
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
  )
  return Math.round((asUTC - date.getTime()) / MIN_MS)
}

function localWallClock(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  let hour = map.hour
  if (hour === '24') hour = '00'
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}`
}

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 365,
): DstTrap[] {
  if (timezone === 'UTC' || !isValidTimezone(timezone)) return []
  const fromMs = fromISO ? Date.parse(fromISO) : Date.now()
  if (Number.isNaN(fromMs)) return []
  const toMs = fromMs + days * DAY_MS

  // Walk the window hourly to find offset transitions.
  const transitions: Array<{ at: number; before: number; after: number }> = []
  let prevOffset = tzOffsetMinutes(new Date(fromMs), timezone)
  for (let t = fromMs + HOUR_MS; t <= toMs; t += HOUR_MS) {
    const off = tzOffsetMinutes(new Date(t), timezone)
    if (off !== prevOffset) {
      // narrow to the minute
      let lo = t - HOUR_MS
      let hi = t
      while (hi - lo > MIN_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MIN_MS) * MIN_MS
        if (tzOffsetMinutes(new Date(mid), timezone) === prevOffset) lo = mid
        else hi = mid
      }
      transitions.push({ at: hi, before: prevOffset, after: off })
      prevOffset = off
    }
  }
  if (transitions.length === 0) return []

  // Which local hours does this schedule fire at? For rate schedules every
  // local hour is in play; for cron use the parsed firing local hours.
  const out: DstTrap[] = []
  const fires = nextFirings(kind, expr, timezone, new Date(fromMs).toISOString(), 5000).map(
    (iso) => Date.parse(iso),
  )

  for (const tr of transitions) {
    const gap = tr.after - tr.before // minutes; >0 spring-forward, <0 fall-back
    const lo = tr.at - 90 * MIN_MS
    const hi = tr.at + 90 * MIN_MS
    const nearby = fires.filter((t) => t >= lo && t <= hi)
    for (const t of nearby) {
      const d = new Date(t)
      if (gap > 0) {
        // spring-forward: wall-clock times in the gap are skipped
        out.push({ type: 'skip', atLocal: localWallClock(d, timezone), atUtc: d.toISOString() })
      } else {
        // fall-back: wall-clock times repeat -> ambiguous / potential double-fire
        out.push({
          type: 'ambiguous',
          atLocal: localWallClock(d, timezone),
          atUtc: d.toISOString(),
        })
      }
    }
    if (gap < 0 && nearby.length >= 2) {
      const d = new Date(nearby[0])
      out.push({
        type: 'double_fire',
        atLocal: localWallClock(d, timezone),
        atUtc: d.toISOString(),
      })
    }
  }

  // de-dup
  const seen = new Set<string>()
  return out.filter((t) => {
    const k = `${t.type}|${t.atUtc}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------------------------------------------------------------------------
// coverageGaps — windows that no job covers (a "window" is a desired interval)
// ---------------------------------------------------------------------------

export interface CoverageWindow {
  start: string
  end: string
  label?: string
}

export interface CoverageGap {
  start: string
  end: string
  label?: string
  durationMinutes: number
}

export function coverageGaps(
  windows: CoverageWindow[],
  jobs: Job[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromMs = Date.now()
  const toMs = fromMs + horizonDays * DAY_MS
  const fromISO = new Date(fromMs).toISOString()

  // collect all firing instants within horizon
  const fireTimes: number[] = []
  for (const job of jobs) {
    for (const iso of nextFirings(job.kind, job.expr, job.timezone, fromISO, 2000)) {
      const t = Date.parse(iso)
      if (t > toMs) break
      fireTimes.push(t)
    }
  }
  fireTimes.sort((a, b) => a - b)

  const out: CoverageGap[] = []
  for (const w of windows) {
    const ws = Date.parse(w.start)
    const we = Date.parse(w.end)
    if (Number.isNaN(ws) || Number.isNaN(we) || we <= ws) continue
    const inside = fireTimes.filter((t) => t >= ws && t <= we)
    if (inside.length === 0) {
      out.push({
        start: w.start,
        end: w.end,
        label: w.label,
        durationMinutes: Math.round((we - ws) / MIN_MS),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// autoSpread — suggest staggered cron expressions to relieve collisions
// ---------------------------------------------------------------------------

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

export function autoSpread(
  jobs: Job[],
  opts: { threshold?: number; horizonDays?: number } = {},
): SpreadSuggestion[] {
  const threshold = Math.max(2, opts.threshold ?? 2)
  const collisions = computeCollisions(jobs, {
    threshold,
    horizonDays: opts.horizonDays ?? 7,
  })
  if (collisions.length === 0) return []

  // jobs implicated in the most collisions are candidates to be moved
  const offenders = new Map<string, number>()
  for (const col of collisions) {
    for (const id of col.jobIds) offenders.set(id, (offenders.get(id) ?? 0) + 1)
  }

  const byId = new Map(jobs.map((j) => [j.id, j]))
  const suggestions: SpreadSuggestion[] = []
  // keep the first job in each crowded minute; stagger the rest by a minute offset
  let stagger = 1
  const ranked = Array.from(offenders.entries()).sort((a, b) => b[1] - a[1])

  for (const [id] of ranked.slice(1)) {
    const job = byId.get(id)
    if (!job) continue
    let suggestedExpr = job.expr
    let reason = ''
    if (job.kind === 'cron') {
      const parts = job.expr.trim().split(/\s+/)
      if (parts.length >= 5) {
        const baseMin = parts[0] === '*' || parts[0].includes('/') ? 0 : parseInt(parts[0], 10) || 0
        parts[0] = String((baseMin + stagger) % 60)
        suggestedExpr = parts.join(' ')
        reason = `Shift minute by ${stagger} to avoid concurrency >= ${threshold}`
      } else {
        reason = 'Unable to stagger non-standard cron; review manually'
      }
    } else if (job.kind === 'rate') {
      const r = parseRate(job.expr)
      if (r) {
        suggestedExpr = `every ${r.n} ${r.unit}`
        reason = `Rate job collides; offset its start by ${stagger} minute(s)`
      }
    } else {
      reason = 'One-off collides; move to a quieter minute'
    }
    suggestions.push({ jobId: id, suggestedExpr, reason })
    stagger = (stagger % 5) + 1
  }

  return suggestions
}
