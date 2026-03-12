export async function getAnalyticsSnapshot(sql) {
  const [overview] = await sql`
    with base as (
      select
        count(*) filter (where direction = 'outbound')::int as outbound_total,
        count(*) filter (where sent_at is not null)::int as sent_total
      from public.message_attempts
    ), events as (
      select
        count(*) filter (where event_type = 'opened')::int as opened_total,
        count(*) filter (where event_type = 'clicked')::int as clicked_total,
        count(*) filter (where event_type = 'replied')::int as replied_total,
        count(*) filter (where event_type = 'bounced')::int as bounced_total,
        count(*) filter (where event_type = 'failed')::int as failed_total
      from public.message_events
    )
    select * from base cross join events
  `;

  const dailySeries = await sql`
    with sent as (
      select date_trunc('day', coalesce(sent_at, created_at))::date as day, count(*)::int as sent
      from public.message_attempts
      where direction = 'outbound'
        and coalesce(sent_at, created_at) >= now() - interval '14 days'
      group by 1
    ), replied as (
      select date_trunc('day', me.created_at)::date as day, count(*)::int as replied
      from public.message_events me
      where me.event_type = 'replied'
        and me.created_at >= now() - interval '14 days'
      group by 1
    )
    select
      gs.day::date as day,
      coalesce(sent.sent, 0)::int as sent,
      coalesce(replied.replied, 0)::int as replied
    from generate_series(current_date - interval '13 days', current_date, interval '1 day') as gs(day)
    left join sent on sent.day = gs.day::date
    left join replied on replied.day = gs.day::date
    order by gs.day asc
  `;

  const smtpLoad = await sql`
    select
      sa.id,
      sa.account_key,
      sa.from_email,
      sa.daily_limit,
      sa.priority,
      sa.status::text as status,
      sa.last_used_at,
      coalesce(sau.sent_count, 0)::int as sent_today,
      coalesce(sau.failed_count, 0)::int as failed_today,
      greatest(sa.daily_limit - coalesce(sau.sent_count, 0), 0)::int as remaining_today,
      round((coalesce(sau.sent_count, 0)::numeric / nullif(sa.daily_limit, 0)) * 100, 1) as load_pct
    from public.smtp_accounts sa
    left join public.smtp_account_usage sau
      on sau.smtp_account_id = sa.id
     and sau.usage_date = (now() at time zone 'UTC')::date
    order by sa.priority asc, sa.created_at asc
  `;

  const errorLogs = await sql`
    select
      ms.created_at,
      coalesce(c.name, '-') as campaign_name,
      coalesce(ms.to_email::text, '-') as to_email,
      coalesce(ms.subject, '-') as subject,
      coalesce(ms.error, 'unknown error') as error,
      coalesce(sa.account_key, '-') as account_key
    from public.message_sends ms
    left join public.campaigns c on c.id = ms.campaign_id
    left join public.smtp_accounts sa on sa.id = ms.smtp_account_id
    where ms.status = 'failed'
    order by ms.created_at desc
    limit 100
  `;

  const outbound = Number(overview?.sent_total || overview?.outbound_total || 0);
  const opened = Number(overview?.opened_total || 0);
  const clicked = Number(overview?.clicked_total || 0);
  const replied = Number(overview?.replied_total || 0);
  const bounced = Number(overview?.bounced_total || 0);
  const failed = Number(overview?.failed_total || 0);

  const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : 0);

  return {
    totals: {
      outbound,
      opened,
      clicked,
      replied,
      bounced,
      failed,
      open_rate: pct(opened, outbound),
      ctr: pct(clicked, outbound),
      reply_rate: pct(replied, outbound),
      bounce_rate: pct(bounced, outbound),
      failure_rate: pct(failed, outbound),
    },
    dailySeries,
    smtpLoad,
    errorLogs,
  };
}
