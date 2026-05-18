// @ts-nocheck — Deno runtime, not Node.js
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const FROM = 'Control Report <report@updates.utmb.world>'
const RESEND_URL = 'https://api.resend.com/emails'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS })
  }

  const RESEND_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: CORS })
  }

  let to, subject, html
  try {
    const body = await req.json()
    to = body.to
    subject = body.subject
    html = body.html
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS })
  }

  if (!to || !subject || !html) {
    return new Response(JSON.stringify({ error: 'Missing required fields: to, subject, html' }), { status: 400, headers: CORS })
  }

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', await res.text())
    return new Response(JSON.stringify({ error: 'Failed to send email' }), { status: 500, headers: CORS })
  }

  return new Response(JSON.stringify({ message: 'Email sent.' }), { headers: CORS })
})
