import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { cohorts, promos, order_lines, activity_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const buildSchema = z.object({
  promo_id: z.string().min(1),
  name: z.string().min(1).optional(),
})

// Public: list cohorts (newest first; optional ?promo_id filter)
router.get('/', async (c) => {
  const userId = c.req.query('user_id') ?? c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const promoId = c.req.query('promo_id')
  const conds = []
  if (userId) conds.push(eq(cohorts.user_id, userId))
  if (promoId) conds.push(eq(cohorts.promo_id, promoId))
  const rows = conds.length
    ? await db
        .select()
        .from(cohorts)
        .where(conds.length === 1 ? conds[0] : and(...conds))
        .orderBy(desc(cohorts.created_at))
    : await db.select().from(cohorts).orderBy(desc(cohorts.created_at))
  return c.json(rows)
})

// Auth: build acquisition cohort for a promo.
// Cohort = customers acquired during the promo (is_first_order order lines
// attributed to the promo). repeat_rate = fraction of those customers who
// placed at least one further order (any time) after their acquisition.
router.post('/build', authMiddleware, zValidator('json', buildSchema), async (c) => {
  const userId = getUserId(c)
  const { promo_id, name } = c.req.valid('json')

  const [promo] = await db.select().from(promos).where(eq(promos.id, promo_id))
  if (!promo) return c.json({ error: 'Promo not found' }, 404)
  if (promo.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // All order lines attributed to this promo for this user.
  const promoLines = await db
    .select()
    .from(order_lines)
    .where(and(eq(order_lines.user_id, userId), eq(order_lines.promo_id, promo_id)))

  // Acquired customers: those whose first-order flag fired on a promo line.
  const acquired = new Map<string, number>() // customer_id -> first order ts (ms)
  for (const l of promoLines) {
    if (!l.is_first_order) continue
    const ts = new Date(l.order_ts).getTime()
    const prev = acquired.get(l.customer_id)
    if (prev === undefined || ts < prev) acquired.set(l.customer_id, ts)
  }
  const customerIds = Array.from(acquired.keys())

  // Determine repeat behaviour: a customer "repeats" if they have any order
  // line (across the whole dataset) with a later order_ts than their
  // acquisition instant.
  let repeatCount = 0
  if (customerIds.length > 0) {
    const allLines = await db
      .select()
      .from(order_lines)
      .where(eq(order_lines.user_id, userId))
    const repeated = new Set<string>()
    for (const l of allLines) {
      const acqTs = acquired.get(l.customer_id)
      if (acqTs === undefined) continue
      if (new Date(l.order_ts).getTime() > acqTs) repeated.add(l.customer_id)
    }
    repeatCount = repeated.size
  }

  const customerCount = customerIds.length
  const repeatRate = customerCount > 0 ? repeatCount / customerCount : 0

  const [cohort] = await db
    .insert(cohorts)
    .values({
      user_id: userId,
      promo_id,
      name: name ?? `${promo.name} acquisition`,
      customer_count: customerCount,
      repeat_rate: repeatRate,
      customer_ids: customerIds,
    })
    .returning()

  await db.insert(activity_log).values({
    user_id: userId,
    action: 'build',
    entity: 'cohort',
    entity_id: cohort.id,
    detail: { promo_id, customer_count: customerCount, repeat_rate: repeatRate },
  })

  return c.json(cohort, 201)
})

// Auth: delete cohort
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(cohorts).where(eq(cohorts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(cohorts).where(eq(cohorts.id, id))
  await db.insert(activity_log).values({
    user_id: userId,
    action: 'delete',
    entity: 'cohort',
    entity_id: id,
    detail: {},
  })
  return c.json({ success: true })
})

export default router
