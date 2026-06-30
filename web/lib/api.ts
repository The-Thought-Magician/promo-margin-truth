// PromoMarginTruth — frontend API layer.
// Every method maps 1:1 to a backend endpoint: path after /api/proxy/ == path after /api/v1/.
// Relative URLs → same origin → cookies flow → proxy injects X-User-Id.

async function get(path: string) {
  const r = await fetch(`/api/proxy/${path}`)
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `GET ${path} failed (${r.status})`)
  return r.json()
}

async function mutate(method: string, path: string, body?: unknown) {
  const r = await fetch(`/api/proxy/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `${method} ${path} failed (${r.status})`)
  return r.json()
}

const api = {
  // Workspace
  getWorkspace: () => get('workspace'),
  updateWorkspace: (data: unknown) => mutate('PUT', 'workspace', data),

  // SKUs
  getSkus: () => get('skus'),
  getMissingCogs: () => get('skus/missing-cogs'),
  getSku: (id: string) => get(`skus/${id}`),
  createSku: (data: unknown) => mutate('POST', 'skus', data),
  updateSku: (id: string, data: unknown) => mutate('PUT', `skus/${id}`, data),
  deleteSku: (id: string) => mutate('DELETE', `skus/${id}`),
  bulkImportSkus: (skus: unknown[]) => mutate('POST', 'skus/bulk', { skus }),

  // COGS overrides
  getCogsOverrides: (skuId?: string) => get(`cogs${skuId ? `?sku_id=${encodeURIComponent(skuId)}` : ''}`),
  createCogsOverride: (data: unknown) => mutate('POST', 'cogs', data),
  deleteCogsOverride: (id: string) => mutate('DELETE', `cogs/${id}`),

  // Promos
  getPromos: () => get('promos'),
  getPromo: (id: string) => get(`promos/${id}`),
  createPromo: (data: unknown) => mutate('POST', 'promos', data),
  updatePromo: (id: string, data: unknown) => mutate('PUT', `promos/${id}`, data),
  deletePromo: (id: string) => mutate('DELETE', `promos/${id}`),
  clonePromo: (id: string, data?: unknown) => mutate('POST', `promos/${id}/clone`, data ?? {}),
  setPromoStatus: (id: string, status: string) => mutate('POST', `promos/${id}/status`, { status }),

  // Ingestion
  getIngestionRuns: () => get('ingest/runs'),
  getIngestionRun: (id: string) => get(`ingest/runs/${id}`),
  uploadData: (data: unknown) => mutate('POST', 'ingest/upload', data),
  deleteIngestionRun: (id: string) => mutate('DELETE', `ingest/runs/${id}`),
  seedSampleData: () => mutate('POST', 'ingest/sample', {}),

  // Orders
  getOrders: (filters?: Record<string, string | number>) => {
    const qs = filters ? '?' + new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString() : ''
    return get(`orders${qs}`)
  },
  getOrdersSummary: (filters?: Record<string, string | number>) => {
    const qs = filters ? '?' + new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString() : ''
    return get(`orders/summary${qs}`)
  },

  // Column mappings
  getMappings: () => get('mappings'),
  createMapping: (data: unknown) => mutate('POST', 'mappings', data),
  updateMapping: (id: string, data: unknown) => mutate('PUT', `mappings/${id}`, data),
  deleteMapping: (id: string) => mutate('DELETE', `mappings/${id}`),

  // P&L
  getPnlList: () => get('pnl'),
  getPnl: (promoId: string) => get(`pnl/${promoId}`),
  computePnl: (promoId: string) => mutate('POST', `pnl/${promoId}/compute`, {}),

  // Incrementality
  getIncrementality: (promoId: string) => get(`incrementality/${promoId}`),
  computeIncrementality: (promoId: string, method: string) => mutate('POST', `incrementality/${promoId}/compute`, { method }),

  // Cannibalization
  getCannibalization: (promoId: string) => get(`cannibalization/${promoId}`),
  computeCannibalization: (promoId: string) => mutate('POST', `cannibalization/${promoId}/compute`, {}),

  // Customer split
  getSplit: (promoId: string) => get(`splits/${promoId}`),
  computeSplit: (promoId: string) => mutate('POST', `splits/${promoId}/compute`, {}),

  // Elasticity
  getElasticityCurves: () => get('elasticity'),
  getElasticityCurve: (scope: string, scopeId: string) => get(`elasticity/${scope}/${scopeId}`),
  fitElasticity: (data: { scope: string; scope_id: string }) => mutate('POST', 'elasticity/fit', data),
  projectElasticityPoint: (data: { scope: string; scope_id: string; depth_pct: number }) => mutate('POST', 'elasticity/point', data),

  // Scenarios
  getScenarios: () => get('scenarios'),
  getScenario: (id: string) => get(`scenarios/${id}`),
  createScenario: (data: unknown) => mutate('POST', 'scenarios', data),
  updateScenario: (id: string, data: unknown) => mutate('PUT', `scenarios/${id}`, data),
  deleteScenario: (id: string) => mutate('DELETE', `scenarios/${id}`),

  // Alerts
  getAlerts: (status?: string) => get(`alerts${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  scanAlerts: () => mutate('POST', 'alerts/scan', {}),
  ackAlert: (id: string) => mutate('POST', `alerts/${id}/ack`, {}),
  snoozeAlert: (id: string) => mutate('POST', `alerts/${id}/snooze`, {}),
  resolveAlert: (id: string) => mutate('POST', `alerts/${id}/resolve`, {}),

  // Retrospective
  generatePromoRetro: (promoId: string) => mutate('POST', `retrospective/promo/${promoId}`, {}),
  generatePeriodRetro: (data: { start: string; end: string; title: string }) => mutate('POST', 'retrospective/period', data),
  getRecoverySummary: () => get('retrospective/recovery'),

  // Calendar
  getCalendar: () => get('calendar'),
  getCalendarOverlaps: () => get('calendar/overlaps'),
  createCalendarEntry: (data: unknown) => mutate('POST', 'calendar', data),
  updateCalendarEntry: (id: string, data: unknown) => mutate('PUT', `calendar/${id}`, data),
  deleteCalendarEntry: (id: string) => mutate('DELETE', `calendar/${id}`),

  // Cohorts
  getCohorts: () => get('cohorts'),
  buildCohort: (data: { promo_id: string }) => mutate('POST', 'cohorts/build', data),
  deleteCohort: (id: string) => mutate('DELETE', `cohorts/${id}`),

  // Segments
  getSegments: () => get('segments'),
  createSegment: (data: unknown) => mutate('POST', 'segments', data),
  updateSegment: (id: string, data: unknown) => mutate('PUT', `segments/${id}`, data),
  deleteSegment: (id: string) => mutate('DELETE', `segments/${id}`),

  // Channels
  getChannelStats: (promoId: string) => get(`channels/${promoId}`),
  computeChannelStats: (promoId: string) => mutate('POST', `channels/${promoId}/compute`, {}),

  // Benchmarks
  getBenchmarks: () => get('benchmarks'),
  getBenchmarkVariance: () => get('benchmarks/variance'),
  createBenchmark: (data: unknown) => mutate('POST', 'benchmarks', data),
  updateBenchmark: (id: string, data: unknown) => mutate('PUT', `benchmarks/${id}`, data),
  deleteBenchmark: (id: string) => mutate('DELETE', `benchmarks/${id}`),

  // Dashboard
  getDashboardOverview: () => get('dashboard/overview'),
  getDashboardLeaderboard: () => get('dashboard/leaderboard'),
  getMarginTrend: () => get('dashboard/margin-trend'),

  // Reports
  getReports: () => get('reports'),
  getReport: (id: string) => get(`reports/${id}`),
  rerunReport: (id: string) => mutate('POST', `reports/${id}/rerun`, {}),
  deleteReport: (id: string) => mutate('DELETE', `reports/${id}`),

  // Notifications
  getNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => mutate('POST', `notifications/${id}/read`, {}),
  markAllNotificationsRead: () => mutate('POST', 'notifications/read-all', {}),

  // Activity
  getActivity: (filters?: Record<string, string | number>) => {
    const qs = filters ? '?' + new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])).toString() : ''
    return get(`activity${qs}`)
  },

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => mutate('POST', 'billing/checkout', {}),
  openBillingPortal: () => mutate('POST', 'billing/portal', {}),
}

export default api
