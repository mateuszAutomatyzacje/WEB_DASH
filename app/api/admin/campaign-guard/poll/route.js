// Proxy endpoint: WebDash -> n8n Campaign Guard webhook
// Configure env:
// - N8N_GUARD_WEBHOOK_URL=https://.../webhook/...
// - N8N_GUARD_TOKEN=SUPER_SECRET_TOKEN

export async function POST(req) {
  try {
    const webhookUrl = process.env.N8N_GUARD_WEBHOOK_URL;
    const token = process.env.N8N_GUARD_TOKEN;

    if (!webhookUrl) {
      return new Response('Missing env N8N_GUARD_WEBHOOK_URL', { status: 500 });
    }
    if (!token) {
      return new Response('Missing env N8N_GUARD_TOKEN', { status: 500 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const payload = {
      token,
      campaign_id: body?.campaign_id ?? null,
      limit: Number.isFinite(body?.limit) ? body.limit : 100,
      dry_run: Boolean(body?.dry_run ?? false),
    };

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(t);

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return Response.json(
      {
        ok: res.ok,
        forwarded_to: webhookUrl,
        request: payload,
        response: data,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (e) {
    return new Response(String(e?.message || e), { status: 500 });
  }
}
