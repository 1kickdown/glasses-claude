import { timingSafeEqual } from 'node:crypto'

export type Msg = { role: 'user' | 'assistant'; content: string }
type Env = Record<string, string | undefined>
type Req = { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown }
type Res = { status(code: number): Res; json(body: unknown): unknown }
type Ask = (messages: Msg[], opts: { apiKey: string; model: string }) => Promise<string>

const MAX_MESSAGES = 20
const MAX_CONTENT = 2000
const DEFAULT_MODEL = 'claude-haiku-5-5'
const SYSTEM_PROMPT =
  'Ты ассистент на умных очках с крошечным экраном. Отвечай на языке пользователя, ' +
  'очень кратко (до 40 слов), простым текстом без markdown, списков и эмодзи.'

export function checkToken(header: string | undefined, expected: string): boolean {
  if (!expected || !header || !header.startsWith('Bearer ')) return false
  const got = Buffer.from(header.slice(7))
  const want = Buffer.from(expected)
  if (got.length !== want.length) return false
  return timingSafeEqual(got, want)
}

type Validation = { ok: true; messages: Msg[] } | { ok: false; status: 400 | 413; error: string }

export function validateChat(body: unknown): Validation {
  if (!Array.isArray(body) || body.length === 0) return { ok: false, status: 400, error: 'messages required' }
  if (body.length > MAX_MESSAGES) return { ok: false, status: 413, error: 'too many messages' }
  const messages: Msg[] = []
  for (const m of body) {
    if (!m || typeof m !== 'object') return { ok: false, status: 400, error: 'bad message' }
    const { role, content } = m as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string')
      return { ok: false, status: 400, error: 'bad message' }
    if (content.length > MAX_CONTENT) return { ok: false, status: 413, error: 'message too long' }
    messages.push({ role, content })
  }
  if (messages.some((m, i) => m.role !== (i % 2 === 0 ? 'user' : 'assistant')))
    return { ok: false, status: 400, error: 'roles must alternate starting with user' }
  const last = messages[messages.length - 1]
  if (last.role !== 'user' || last.content.trim() === '') return { ok: false, status: 400, error: 'last must be non-empty user message' }
  return { ok: true, messages }
}

export function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>()
  return (key: string, now: number = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
    if (recent.length >= max) { hits.set(key, recent); return false }
    recent.push(now)
    hits.set(key, recent)
    return true
  }
}

export const askClaude: Ask = async (messages, { apiKey, model }) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const resp = await client.messages.create({ model, max_tokens: 300, system: SYSTEM_PROMPT, messages })
  const block = resp.content.find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text.trim() : ''
}

export function makeHandler(deps: { env: Env; ask: Ask; limiter: (key: string) => boolean }) {
  return async (req: Req, res: Res): Promise<void> => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return }
    const { ANTHROPIC_API_KEY: apiKey, ACCESS_TOKEN: token, MODEL } = deps.env
    if (!apiKey || !token) { res.status(500).json({ error: 'config' }); return }
    const auth = req.headers['authorization']
    if (!checkToken(Array.isArray(auth) ? auth[0] : auth, token)) { res.status(401).json({ error: 'auth' }); return }
    if (!deps.limiter(token)) { res.status(429).json({ error: 'rate' }); return }
    const v = validateChat(req.body)
    if (!v.ok) { res.status(v.status).json({ error: v.error }); return }
    try {
      const reply = await deps.ask(v.messages, { apiKey, model: MODEL || DEFAULT_MODEL })
      res.status(200).json({ reply })
    } catch {
      res.status(502).json({ error: 'upstream' })
    }
  }
}

export default makeHandler({ env: process.env, ask: askClaude, limiter: makeLimiter(20, 60_000) })
