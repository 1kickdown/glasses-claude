import { createHmac, timingSafeEqual } from 'node:crypto'

export const config = { api: { bodyParser: false }, maxDuration: 30 }

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export type Turn = { role: 'user' | 'assistant'; content: string | Block[] }
export type Incoming = {
  id: string
  from: string
  type: 'text' | 'image' | 'audio' | 'other'
  text?: string
  mediaId?: string
  caption?: string
}
type Env = Record<string, string | undefined>
type Deps = {
  env: Env
  ask: (turns: Turn[], opts: { apiKey: string; model: string }) => Promise<string>
  sendText: (to: string, text: string) => Promise<void>
  downloadImage: (mediaId: string) => Promise<{ data: string; mediaType: string }>
  dedup: (id: string) => boolean
}

const DEFAULT_MODEL = 'claude-haiku-5-5'
const SYSTEM_PROMPT =
  'Ты ассистент на умных очках с крошечным экраном. Отвечай на языке пользователя, ' +
  'очень кратко (до 40 слов), простым текстом без markdown, списков и эмодзи.'
const MAX_REPLY = 1000
const HISTORY = 6
const GRAPH = 'https://graph.facebook.com/v21.0'

export function verifySignature(raw: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header || !header.startsWith('sha256=')) return false
  const want = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex'))
  const got = Buffer.from(header.slice(7))
  return got.length === want.length && timingSafeEqual(got, want)
}

export function parseWebhook(body: unknown): Incoming[] {
  const out: Incoming[] = []
  const entries = (body as any)?.entry
  if (!Array.isArray(entries)) return out
  for (const e of entries) {
    if (!Array.isArray(e?.changes)) continue
    for (const c of e.changes) {
      const msgs = c?.value?.messages
      if (!Array.isArray(msgs)) continue
      for (const m of msgs) {
        if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue
        if (m.type === 'text') out.push({ id: m.id, from: m.from, type: 'text', text: String(m.text?.body ?? '') })
        else if (m.type === 'image') out.push({ id: m.id, from: m.from, type: 'image', mediaId: m.image?.id, caption: m.image?.caption })
        else if (m.type === 'audio') out.push({ id: m.id, from: m.from, type: 'audio', mediaId: m.audio?.id })
        else out.push({ id: m.id, from: m.from, type: 'other' })
      }
    }
  }
  return out
}

export function makeDedup(max = 500) {
  const seen = new Set<string>()
  return (id: string): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    if (seen.size > max) seen.delete(seen.values().next().value as string)
    return true
  }
}

export function makeHandler(deps: Deps) {
  const history = new Map<string, Turn[]>()

  async function reply(to: string, text: string) {
    await deps.sendText(to, text.slice(0, MAX_REPLY))
  }

  async function handleOne(m: Incoming, apiKey: string, model: string) {
    if (m.type === 'audio') return reply(m.from, 'Голосовые я не слушаю. Продиктуй текстом или пришли фото.')
    if (m.type === 'other') return reply(m.from, 'Понимаю только текст и фото.')
    const past = history.get(m.from) ?? []
    let content: string | Block[]
    let stored: string
    try {
      if (m.type === 'image') {
        const img = await deps.downloadImage(m.mediaId ?? '')
        const q = m.caption?.trim() || 'Опиши, что на фото, и что важно.'
        content = [
          { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
          { type: 'text', text: q },
        ]
        stored = `[фото] ${q}`
      } else {
        content = stored = (m.text ?? '').trim()
        if (!content) return
      }
      const answer = await deps.ask([...past, { role: 'user', content }], { apiKey, model })
      history.set(m.from, [...past, { role: 'user', content: stored }, { role: 'assistant', content: answer }].slice(-HISTORY) as Turn[])
      await reply(m.from, answer)
    } catch {
      await reply(m.from, 'Ошибка, попробуй ещё раз.').catch(() => {})
    }
  }

  return async (req: any, res: any): Promise<void> => {
    const { WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, ALLOWED_NUMBER, ANTHROPIC_API_KEY, MODEL } = deps.env
    if (req.method === 'GET') {
      const q = req.query ?? {}
      if (q['hub.mode'] === 'subscribe' && WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === WHATSAPP_VERIFY_TOKEN) {
        res.status(200).send(String(q['hub.challenge'] ?? ''))
      } else res.status(403).send('forbidden')
      return
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return }
    if (!WHATSAPP_APP_SECRET || !ALLOWED_NUMBER || !ANTHROPIC_API_KEY) { res.status(500).json({ error: 'config' }); return }
    const raw: string = req.rawBody ?? ''
    const h = req.headers['x-hub-signature-256']
    if (!verifySignature(raw, Array.isArray(h) ? h[0] : h, WHATSAPP_APP_SECRET)) { res.status(401).json({ error: 'signature' }); return }
    let body: unknown
    try { body = JSON.parse(raw) } catch { res.status(400).json({ error: 'json' }); return }
    const allowed = ALLOWED_NUMBER.replace(/\D/g, '')
    for (const m of parseWebhook(body)) {
      if (m.from.replace(/\D/g, '') !== allowed) continue
      if (!deps.dedup(m.id)) continue
      await handleOne(m, ANTHROPIC_API_KEY, MODEL || DEFAULT_MODEL)
    }
    res.status(200).json({ ok: true })
  }
}

async function askClaude(turns: Turn[], { apiKey, model }: { apiKey: string; model: string }): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({ model, max_tokens: 300, system: SYSTEM_PROMPT, messages: turns as any })
  const block = resp.content.find((b: any) => b.type === 'text') as any
  return block?.text?.trim() ?? ''
}

async function sendText(to: string, text: string): Promise<void> {
  const r = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
  })
  if (!r.ok) throw new Error(`send ${r.status}`)
}

async function downloadImage(mediaId: string): Promise<{ data: string; mediaType: string }> {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: auth })
  if (!meta.ok) throw new Error(`media meta ${meta.status}`)
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string }
  const file = await fetch(url, { headers: auth })
  if (!file.ok) throw new Error(`media ${file.status}`)
  return { data: Buffer.from(await file.arrayBuffer()).toString('base64'), mediaType: mime_type }
}

const handler = makeHandler({ env: process.env, ask: askClaude, sendText, downloadImage, dedup: makeDedup() })

export default async function (req: any, res: any) {
  if (req.method === 'POST') {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(Buffer.from(c))
    req.rawBody = Buffer.concat(chunks).toString('utf8')
  }
  return handler(req, res)
}
