export async function computeLiveMetrics(sql) {
  const [
    leadStatusRows,
    campaignStatusRows,
    assignmentStatusRows,
    eventTypeRows,
    totalsRows,
    queueRows,
    messageAttemptRows,
  ] = await Promise.all([
    sql`
      select status::text as key, count(*)::int as count
      from leads
      group by status
      order by count desc
    `,
    sql`
      select status::text as key, count(*)::int as count
      from campaigns
      group by status
      order by count desc
    `,
    sql`
      select status::text as key, count(*)::int as count
      from lead_assignments
      group by status
      order by count desc
    `,
    sql`
      select event_type::text as key, count(*)::int as count
      from message_events
      group by event_type
      order by count desc
    `,
    sql`
      select
        (select count(*)::int from leads) as leads_total,
        (select count(*)::int from campaigns) as campaigns_total,
        (select count(*)::int from campaign_leads) as campaign_leads_total,
        (select count(*)::int from workers where is_active = true) as workers_active,
        (select count(*)::int from lead_assignments) as assignments_total,
        (select count(*)::int from lead_assignments where status in ('assigned','accepted','in_progress')) as assignments_open,
        (select count(*)::int from lead_assignments where status in ('assigned','accepted','in_progress') and sla_due_at is not null and sla_due_at < now()) as assignments_overdue
    `,
    sql`
      select
        count(*)::int as queued_total,
        count(*) filter (where next_run_at <= now())::int as ready_now,
        min(next_run_at) as next_run_earliest
      from campaign_leads
      where state in ('queued', 'in_campaign') and next_run_at is not null
    `,
    sql`
      select
        count(*)::int as attempts_total,
        count(*) filter (where direction = 'outbound')::int as attempts_outbound,
        count(*) filter (where direction = 'inbound')::int as attempts_inbound,
        count(*) filter (where sent_at is not null)::int as attempts_sent
      from message_attempts
    `,
  ]);

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.count]));
  const totals = totalsRows[0] || {};
  const queue = queueRows[0] || {};
  const attempts = messageAttemptRows[0] || {};

  return {
    source: 'live',
    generated_at: new Date().toISOString(),
    totals,
    queue,
    message_attempts: attempts,
    lead_counts: toMap(leadStatusRows),
    campaign_counts: toMap(campaignStatusRows),
    assignment_counts: toMap(assignmentStatusRows),
    message_event_counts: toMap(eventTypeRows),
  };
}
