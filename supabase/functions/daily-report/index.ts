// @ts-nocheck — Deno runtime, not Node.js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const FROM = 'Control Report <report@updates.utmb.world>'
const RESEND_URL = 'https://api.resend.com/emails'

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', timeStyle: 'short' })
}

function buildRaceSection(raceName, controls, gearMap) {
  const total = controls.length
  const okCount = controls.filter(c => c.resultat === 'ok').length
  const koCount = controls.filter(c => c.resultat === 'ko').length

  const byDossard = {}
  for (const c of controls) (byDossard[c.dossard] ??= []).push(c)
  const stillKO = Object.values(byDossard)
    .filter(arr => arr.at(-1).resultat === 'ko')
    .map(arr => arr.at(-1))

  let html = `
    <h3 style="color:#444;margin:12px 0 6px;font-size:15px;">${esc(raceName)}</h3>
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
    html += `
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
      const m = ko.marshals
      const marshalName = m ? `${esc(m.firstName)} ${esc(m.lastName)}` : '—'
      const gearLabel = ko.materiel_manquant ? esc(gearMap[ko.materiel_manquant] ?? ko.materiel_manquant) : '—'
      html += `
        <tr>
          <td style="padding:4px 10px;border:1px solid #ddd;font-weight:bold;">${esc(ko.dossard)}</td>
          <td style="padding:4px 10px;border:1px solid #ddd;">${gearLabel}</td>
          <td style="padding:4px 10px;border:1px solid #ddd;">${ko.commentaire ? esc(ko.commentaire) : '—'}</td>
          <td style="padding:4px 10px;border:1px solid #ddd;">${marshalName}</td>
          <td style="padding:4px 10px;border:1px solid #ddd;">${fmtTime(new Date(ko.created_at))}</td>
        </tr>`
    }
    html += '</table>'
  }
  return html
}

function wrapEmail(title, subtitle, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#333;">
  <h1 style="font-size:22px;color:#1a1a2e;border-bottom:2px solid #eee;padding-bottom:10px;margin-bottom:6px;">
    📋 ${title}
  </h1>
  <p style="color:#888;font-size:13px;margin-top:0;">${subtitle}</p>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #eee;margin-top:32px;">
  <p style="color:#bbb;font-size:11px;">Automated report · Contrôle Coureurs</p>
</body></html>`
}

async function sendEmail(apiKey, to, subject, html, bcc = []) {
  const payload = { from: FROM, to: Array.isArray(to) ? to : [to], subject, html }
  if (bcc.length) payload.bcc = bcc
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) console.error('Resend error:', await res.text())
  return res.ok
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  )
  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  const REPORT_TO = Deno.env.get('REPORT_TO_EMAIL').split(',').map(e => e.trim())

  let force = false
  let forceEventId = null
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      force = body?.force === true
      forceEventId = body?.force_event_id ?? null
    } catch { /* ok */ }
  }

  const now = new Date()
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const dateStr = now.toLocaleDateString('en-GB', { timeZone: 'Europe/Paris', dateStyle: 'medium' })
  const parisNow = now.toLocaleString('en-GB', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' })
  const parisSince = since.toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', timeStyle: 'short' })
  const subtitle = (count) =>
    `Last 24 hours · ${parisSince} → ${parisNow} (Paris time)${count ? ` · <strong>${count}</strong> check${count > 1 ? 's' : ''}` : ''}`

  // Fetch gear labels once — used by all report types
  const { data: gearItems } = await supabase.from('gear').select('code, label_en')
  const gearMap = {}
  gearItems?.forEach(g => { gearMap[g.code] = g.label_en })

  // ── Event-specific force-send ──────────────────────────────────────────────
  if (forceEventId !== null) {
    const { data: event } = await supabase
      .from('events').select('id, name, report_email').eq('id', forceEventId).single()

    if (!event?.report_email) {
      return new Response(
        JSON.stringify({ error: 'No report email configured for this event.' }),
        { status: 400, headers: CORS },
      )
    }

    const { data: raceRows } = await supabase.from('races').select('id').eq('event_id', forceEventId)
    const raceIds = raceRows?.map(r => r.id) ?? []

    const { data: controls } = raceIds.length
      ? await supabase
          .from('controles')
          .select('id, dossard, resultat, materiel_manquant, commentaire, created_at, races(id, name), marshals(firstName, lastName)')
          .in('race_id', raceIds)
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: true })
      : { data: [] }

    let bodyHtml = ''
    if (!controls?.length) {
      bodyHtml = '<p style="color:#888;">No controls recorded in the last 24 hours for this event.</p>'
    } else {
      const raceMap = {}
      for (const c of controls) {
        if (!c.races) continue
        ;(raceMap[c.races.id] ??= { name: c.races.name, controls: [] }).controls.push(c)
      }
      for (const race of Object.values(raceMap)) bodyHtml += buildRaceSection(race.name, race.controls, gearMap)
    }

    const html = wrapEmail(`${esc(event.name)} — Control Report — ${dateStr}`, subtitle(controls?.length), bodyHtml)
    const ok = await sendEmail(RESEND_KEY, event.report_email, `[${event.name}] Control Report — ${dateStr}`, html, REPORT_TO)
    return new Response(
      JSON.stringify({ message: ok ? 'Report sent.' : 'No controls in the last 24 hours for this event.' }),
      { status: ok ? 200 : 500, headers: CORS },
    )
  }

  // ── General report ─────────────────────────────────────────────────────────
  const { data: controls, error } = await supabase
    .from('controles')
    .select('id, dossard, resultat, materiel_manquant, commentaire, created_at, race_id, races(id, name, events(id, name)), marshals(firstName, lastName)')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS })
  }

  const hasControls = controls?.length > 0

  if (hasControls || force) {
    let bodyHtml = ''
    if (!hasControls) {
      bodyHtml = '<p style="color:#888;">No controls recorded in the last 24 hours.</p>'
    } else {
      const eventsMap = {}
      for (const c of controls) {
        if (!c.races) continue
        const ev = c.races.events
        if (!eventsMap[ev.id]) eventsMap[ev.id] = { name: ev.name, races: {} }
        ;(eventsMap[ev.id].races[c.races.id] ??= { name: c.races.name, controls: [] }).controls.push(c)
      }
      for (const ev of Object.values(eventsMap)) {
        bodyHtml += `<h2 style="color:#2d6a4f;margin-top:28px;margin-bottom:4px;font-size:18px;">${esc(ev.name)}</h2>`
        for (const race of Object.values(ev.races)) bodyHtml += buildRaceSection(race.name, race.controls, gearMap)
      }
    }
    const html = wrapEmail(`Daily Control Report — ${dateStr}`, subtitle(hasControls ? controls.length : 0), bodyHtml)
    await sendEmail(RESEND_KEY, REPORT_TO, `Control Report — ${dateStr}`, html)
  }

  // ── Event-specific cron reports (skipped on force-send) ────────────────────
  if (!force) {
    const { data: enabledEvents } = await supabase
      .from('events')
      .select('id, name, report_email')
      .eq('report_enabled', true)
      .not('report_email', 'is', null)

    for (const event of enabledEvents ?? []) {
      const { data: raceRows } = await supabase.from('races').select('id').eq('event_id', event.id)
      const raceIds = raceRows?.map(r => r.id) ?? []
      if (!raceIds.length) continue

      const { data: evControls } = await supabase
        .from('controles')
        .select('id, dossard, resultat, materiel_manquant, commentaire, created_at, races(id, name), marshals(firstName, lastName)')
        .in('race_id', raceIds)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: true })

      if (!evControls?.length) continue

      const raceMap = {}
      for (const c of evControls) {
        if (!c.races) continue
        ;(raceMap[c.races.id] ??= { name: c.races.name, controls: [] }).controls.push(c)
      }
      let bodyHtml = ''
      for (const race of Object.values(raceMap)) bodyHtml += buildRaceSection(race.name, race.controls, gearMap)

      const html = wrapEmail(`${esc(event.name)} — Control Report — ${dateStr}`, subtitle(evControls.length), bodyHtml)
      await sendEmail(RESEND_KEY, event.report_email, `[${event.name}] Control Report — ${dateStr}`, html, REPORT_TO)
    }
  }

  return new Response(JSON.stringify({ message: hasControls || force ? 'Report sent.' : 'No controls in the last 24 hours. Email not sent.' }), { headers: CORS })
})
