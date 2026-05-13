import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ReplyBody {
  event_id: string
  ig_account_id: string
  sender_id?: string
  comment_id?: string
  reply_text: string
  event_type: 'dm' | 'comments' | 'comment'
}

async function lookupAccountToken(
  supabase: ReturnType<typeof createClient>,
  igAccountId: string,
): Promise<{ token: string; username: string | null } | null> {
  // Try ig_accounts first (Instagram Lite)
  const { data: lite } = await supabase
    .from('ig_accounts')
    .select('access_token, username')
    .eq('ig_user_id', igAccountId)
    .maybeSingle()
  if (lite?.access_token) return { token: lite.access_token as string, username: (lite.username as string) ?? null }

  // Fallback to legacy instagram_accounts
  const { data: legacy } = await supabase
    .from('instagram_accounts')
    .select('access_token, name')
    .eq('instagram_account_id', igAccountId)
    .maybeSingle()
  if (legacy?.access_token) return { token: legacy.access_token as string, username: (legacy.name as string) ?? null }

  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: ReplyBody
  try {
    body = (await req.json()) as ReplyBody
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { event_id, ig_account_id, sender_id, comment_id, reply_text, event_type } = body

  if (!event_id || !ig_account_id || !reply_text || !event_type) {
    return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const account = await lookupAccountToken(supabase, ig_account_id)
  if (!account) {
    return new Response(JSON.stringify({ error: 'Conta Instagram não encontrada' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const isComment = event_type === 'comments' || event_type === 'comment'

  // IGAA-prefixed tokens are Instagram Login API (Lite) and must use graph.instagram.com
  const isIgLiteToken = typeof account.token === 'string' && account.token.startsWith('IGAA')
  const apiBase = isIgLiteToken
    ? 'https://graph.instagram.com/v21.0'
    : 'https://graph.facebook.com/v21.0'

  let apiUrl = ''
  let payload: Record<string, unknown> = {}

  if (isComment) {
    if (!comment_id) {
      return new Response(JSON.stringify({ error: 'comment_id obrigatório para comentário' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    apiUrl = `${apiBase}/${comment_id}/replies`
    payload = { message: reply_text }
  } else {
    if (!sender_id) {
      return new Response(JSON.stringify({ error: 'sender_id obrigatório para DM' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    apiUrl = `${apiBase}/me/messages`
    payload = {
      recipient: { id: sender_id },
      message: { text: reply_text },
    }
  }

  const igResponse = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const igData = await igResponse.json().catch(() => ({}))

  if (!igResponse.ok) {
    console.error('[instagram-reply] erro Meta:', igData)
    return new Response(JSON.stringify({ error: igData?.error?.message || igData?.error || 'Erro Meta', details: igData }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Update original message and mirror as outbound reply
  const nowIso = new Date().toISOString()

  await supabase
    .from('instagram_messages')
    .update({
      status: 'replied',
      replied_at: nowIso,
      reply_text,
    })
    .eq('id', event_id)

  // Insert outbound mirror so it appears in the conversation thread
  const { data: original } = await supabase
    .from('instagram_messages')
    .select('sender_id, instagram_account_id, instagram_account_config_id, lead_id, message_type, post_id, comment_id')
    .eq('id', event_id)
    .maybeSingle()

  if (original) {
    await supabase.from('instagram_messages').insert({
      instagram_account_id: original.instagram_account_id,
      instagram_account_config_id: original.instagram_account_config_id,
      sender_id: original.sender_id,
      sender_name: account.username,
      message_text: reply_text,
      message_type: original.message_type,
      post_id: original.post_id,
      comment_id: isComment ? comment_id : null,
      lead_id: original.lead_id,
      is_outbound: true,
      is_read: true,
      status: 'sent',
    })
  }

  return new Response(JSON.stringify({ success: true, ig: igData }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
