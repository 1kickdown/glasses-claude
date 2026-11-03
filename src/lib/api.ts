export type Msg = { role: 'user' | 'assistant'; content: string }
export type ErrorKind = 'auth' | 'rate' | 'network' | 'server'

export class ApiError extends Error {
  kind: ErrorKind
  constructor(kind: ErrorKind) {
    super(kind)
    this.kind = kind
  }
}

export async function sendChat(messages: Msg[], token: string, f: typeof fetch = fetch): Promise<string> {
  let r: Response
  try {
    r = await f('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(messages),
    })
  } catch {
    throw new ApiError('network')
  }
  if (r.status === 401) throw new ApiError('auth')
  if (r.status === 429) throw new ApiError('rate')
  if (!r.ok) throw new ApiError('server')
  const data = (await r.json()) as { reply?: string }
  return data.reply ?? ''
}
