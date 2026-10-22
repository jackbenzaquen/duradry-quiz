// Private, aggregate-only telemetry for the connected Vercel monitor.
// Never include session/order IDs, contacts, answers, cursors, errors or secrets.
const checkKeys=['database','configuration','sync','outbox','receipt','receipt_scan','orders','storefront','collection'];
const statuses=new Set(['ok','warning','error','unknown']);
const timestamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
const count=value=>value!==null&&value!==undefined&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;

export async function monitoringSnapshot(db,health){
  const now=timestamp(health.checked_at);
  if(!now)throw Error('Invalid monitoring timestamp');
  const rows=await db.query('SELECT key,status,details,checked_at FROM quiz_checks');
  const stored=new Map(rows.map(r=>[r.key,r]));
  const [sessions]=await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE started_at >= $1::timestamptz-interval '24 hours' AND started_at < $1::timestamptz)::int AS starts_24h,
    count(*) FILTER(WHERE completed_at >= $1::timestamptz-interval '24 hours' AND completed_at < $1::timestamptz)::int AS completions_24h,
    count(*) FILTER(WHERE completed_at >= $1::timestamptz-interval '8 days' AND completed_at < $1::timestamptz-interval '24 hours')::int AS completions_prior_7d,
    count(*) FILTER(WHERE completed_at IS NOT NULL)::int AS completed_total,
    count(*) FILTER(WHERE completed_at IS NOT NULL AND started_at IS NULL)::int AS completed_without_start,
    count(*) FILTER(WHERE completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM quiz_outbox o WHERE o.session_id=s.id))::int AS missing_delivery_jobs,
    min(occurred_at) AS first_activity
    FROM quiz_sessions s WHERE source='native' AND NOT is_test`,[now]);
  const [events]=await db.query(`SELECT count(*)::int AS events_24h, count(DISTINCT e.session_id)::int AS active_sessions_24h
    FROM quiz_events e JOIN quiz_sessions s ON s.id=e.session_id
    WHERE s.source='native' AND NOT s.is_test AND e.occurred_at >= $1::timestamptz-interval '24 hours' AND e.occurred_at < $1::timestamptz`,[now]);
  const orders=await db.query(`SELECT o.currency, count(*)::int AS orders_24h,
    count(DISTINCT o.session_id)::int AS converting_sessions_24h, sum(o.amount)::text AS revenue_24h,
    max(o.paid_at) AS latest_order
    FROM quiz_orders o JOIN quiz_sessions s ON s.id=o.session_id
    WHERE s.source='native' AND NOT s.is_test AND s.completed_at IS NOT NULL AND s.started_at IS NOT NULL
    AND o.attribution_method='exact_session_attribute' AND o.paid_at>=s.completed_at
    AND o.paid_at<=s.started_at+interval '30 days'
    AND o.paid_at >= $1::timestamptz-interval '24 hours' AND o.paid_at < $1::timestamptz
    GROUP BY o.currency ORDER BY o.currency`,[now]);
  return {
    schema_version:1,checked_at:now,status:statuses.has(health.status)?health.status:'unknown',
    checks:checkKeys.map(key=>{const c=health.checks.find(c=>c.key===key),s=stored.get(key);return {
      key,status:statuses.has(c?.status)?c.status:'unknown',last_checked_at:timestamp(s?.checked_at)||(['database','configuration','outbox','receipt','collection'].includes(key)?now:null)
    };}),
    queue:Object.fromEntries(['pending','failed','accepted','confirmed','unconfirmed'].map(k=>[k,count(health.queue?.[k])])),
    oldest_pending:timestamp(health.queue?.oldest_pending),latest_receipt:timestamp(health.queue?.latest_receipt),
    latest_event:timestamp(health.latest_activity?.latest_event),latest_completion:timestamp(health.latest_activity?.latest_completion),
    sessions:{...Object.fromEntries(['total','starts_24h','completions_24h','completions_prior_7d','completed_total','completed_without_start','missing_delivery_jobs'].map(k=>[k,count(sessions[k])])),first_activity:timestamp(sessions.first_activity)},
    events:{events_24h:count(events.events_24h),active_sessions_24h:count(events.active_sessions_24h)},
    imports:['receipt_scan','orders'].map(key=>{const d=stored.get(key)?.details||{};return {key,complete:d.complete===true,through:timestamp(d.through),processed:count(d.processed),linked:count(d.linked)};}),
    orders_available:health.orders_available===true,
    orders_by_currency:orders.filter(o=>/^[A-Z]{3}$/.test(o.currency)).map(o=>({currency:o.currency,orders_24h:count(o.orders_24h),converting_sessions_24h:count(o.converting_sessions_24h),revenue_24h:/^\d+(\.\d+)?$/.test(o.revenue_24h)?o.revenue_24h:null,latest_order:timestamp(o.latest_order)}))
  };
}
