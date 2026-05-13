import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let force = false
  if (req.method === 'POST') {
    try { const body = await req.json(); force = body?.force === true } catch { /* ok */ }
  }

  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const { data: controls, error } = await supabase
    .from('controles')
    .select('id, dossard, resultat, materiel_manquant, commentaire, created_at, race_id, races(id, name, events(id, name)), marshals(firstName, lastName)')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS })
  }

  const hasControls = controls && controls.length > 0

  if (!hasControls && !force) {
    return new Response(
      JSON.stringify({ message: 'No controls in the last 24 hours. Email not sent.' }),
      { headers: CORS },
    )
  }

  const { data: gearItems } = await supabase.from('gear').select('code, label_en')
  const gearMap: Record<string, string> = {}
  gearItems?.forEach((g: { code: string; label_en: string }) => { gearMap[g.code] = g.label_en })

  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleString('en-GB', { timeZone: 'Europe/Paris', ...opts })

  const parisNow = fmt(now, { dateStyle: 'full', timeStyle: 'short' } as Intl.DateTimeFormatOptions)
  const parisSince = fmt(since, { timeStyle: 'short' } as Intl.DateTimeFormatOptions)
  const dateStr = fmt(now, { dateStyle: 'medium' } as Intl.DateTimeFormatOptions)

  let bodyHtml = ''

  if (!hasControls) {
    bodyHtml = '<p style="color:#888;">No controls recorded in the last 24 hours.</p>'
  } else {
    type Control = (typeof controls)[0]

    const eventsMap: Record<string, { name: string; races: Record<string, { name: string; controls: Control[] }> }> = {}

    for (const c of controls) {
      const race = c.races as { id: number; name: string; events: { id: number; name: string } }
      if (!race) continue
      const event = race.events
      if (!eventsMap[event.id]) eventsMap[event.id] = { name: event.name, races: {} }
      if (!eventsMap[event.id].races[race.id]) eventsMap[event.id].races[race.id] = { name: race.name, controls: [] }
      eventsMap[event.id].races[race.id].controls.push(c)
    }

    for (const ev of Object.values(eventsMap)) {
      bodyHtml += `<h2 style="color:#2d6a4f;margin-top:28px;margin-bottom:4px;font-size:18px;">${esc(ev.name)}</h2>`

      for (const race of Object.values(ev.races)) {
        const total = race.controls.length
        const okCount = race.controls.filter((c: Control) => c.resultat === 'ok').length
        const koCount = race.controls.filter((c: Control) => c.resultat === 'ko').length

        const byDossard: Record<string, Control[]> = {}
        for (const c of race.controls) {
          ;(byDossard[c.dossard] ??= []).push(c)
        }
        const stillKO = Object.values(byDossard)
          .filter((arr) => arr.at(-1)!.resultat === 'ko')
          .map((arr) => arr.at(-1)!)

        bodyHtml += `
          <h3 style="color:#444;margin:12px 0 6px;font-size:15px;">${esc(race.name)}</h3>
          <table style="border-collapse:collapse;font-size:14px;margin-bottom:10px;">
            <tr>
              <th style="background:#f0f0f0;padding:5px 14px;border:1px solid #ddd;">Total</th>
              <th style="background:#f0f0f0;padding:5px 14px;border:1px solid #ddd;color:#2d6a4f;">✅ OK</th>
              <th style="background:#f0f0f0;padding:5px 14px;border:1px solid #ddd;color:#c0392b;">❌ KO</th>
            </tr>
            <tr>
              <td style="padding:5px 14px;border:1px solid #ddd;text-align:center;">${total}</td>
              <td style="padding:5px 14px;border:1px solid #ddd;text-align:center;">${okCount}</td>
              <td style="padding:5px 14px;border:1px solid #ddd;text-align:center;">${koCount}</td>
            </tr>
          </table>`

        if (stillKO.length > 0) {
          bodyHtml += `
            <p style="color:#c0392b;font-weight:bold;font-size:13px;margin:8px 0 4px;">⚠️ Remaining KOs (${stillKO.length})</p>
            <table style="border-collapse:collapse;font-size:13px;width:100%;margin-bottom:16px;">
              <tr style="background:#fdf0f0;">
                <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Bib</th>
                <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Missing gear</th>
                <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Comment</th>
                <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Marshal</th>
                <th style="padding:4px 10px;border:1px solid #ddd;text-align:left;">Time</th>
              </tr>`

          for (const ko of stillKO) {
            const marshal = ko.marshals as { firstName: string; lastName: string } | null
            const marshalName = marshal ? `${esc(marshal.firstName)} ${esc(marshal.lastName)}` : '—'
            const gearLabel = ko.materiel_manquant
              ? esc(gearMap[ko.materiel_manquant] ?? ko.materiel_manquant)
              : '—'
            const time = fmt(new Date(ko.created_at), { timeStyle: 'short' } as Intl.DateTimeFormatOptions)
            bodyHtml += `
              <tr>
                <td style="padding:4px 10px;border:1px solid #ddd;font-weight:bold;">${esc(ko.dossard)}</td>
                <td style="padding:4px 10px;border:1px solid #ddd;">${gearLabel}</td>
                <td style="padding:4px 10px;border:1px solid #ddd;">${ko.commentaire ? esc(ko.commentaire) : '—'}</td>
                <td style="padding:4px 10px;border:1px solid #ddd;">${marshalName}</td>
                <td style="padding:4px 10px;border:1px solid #ddd;">${time}</td>
              </tr>`
          }
          bodyHtml += '</table>'
        }
      }
    }
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="font-size:22px;color:#1a1a2e;border-bottom:2px solid #eee;padding-bottom:10px;margin-bottom:6px;">
    📋 Daily Control Report — ${dateStr}
  </h1>
  <p style="color:#888;font-size:13px;margin-top:0;">
    Last 24 hours · ${parisSince} → ${parisNow} (Paris time)
    ${hasControls ? `· <strong>${controls!.length}</strong> check${controls!.length > 1 ? 's' : ''}` : ''}
  </p>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #eee;margin-top:32px;">
  <p style="color:#bbb;font-size:11px;">Automated report · Contrôle Coureurs</p>
</body></html>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')!}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Control Report <onboarding@resend.dev>',
      to: [Deno.env.get('REPORT_TO_EMAIL')!],
      subject: `Control Report — ${dateStr}`,
      html,
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.text()
    console.error('Resend error:', err)
    return new Response(JSON.stringify({ error: err }), { status: 500, headers: CORS })
  }

  return new Response(JSON.stringify({ message: 'Report sent.' }), { headers: CORS })
})
