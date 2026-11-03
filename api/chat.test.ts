import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkToken, validateChat, makeLimiter, makeHandler } from './chat.ts'

test('checkToken accepts matching Bearer token', () => {
  assert.equal(checkToken('Bearer abc', 'abc'), true)
})
test('checkToken rejects missing, wrong, shorter, longer, non-Bearer', () => {
  assert.equal(checkToken(undefined, 'abc'), false)
  assert.equal(checkToken('Bearer abd', 'abc'), false)
  assert.equal(checkToken('Bearer ab', 'abc'), false)
  assert.equal(checkToken('Bearer abcd', 'abc'), false)
  assert.equal(checkToken('abc', 'abc'), false)
  assert.equal(checkToken('Bearer ', ''), false)
})

const u = (content: string) => ({ role: 'user', content })
const a = (content: string) => ({ role: 'assistant', content })

test('validateChat rejects blank and non-array', () => {
  for (const body of [[u('')], [u('   ')], 'x', null, { messages: 1 }, []]) {
    const r = validateChat(body as unknown)
    assert.equal(r.ok, false)
  }
})
test('validateChat 413 for too many messages / too long content', () => {
  const many = Array.from({ length: 21 }, (_, i) => (i % 2 === 0 ? u('q') : a('r')))
  const r1 = validateChat(many)
  assert.deepEqual([r1.ok, !r1.ok && r1.status], [false, 413])
  const r2 = validateChat([u('x'.repeat(2001))])
  assert.deepEqual([r2.ok, !r2.ok && r2.status], [false, 413])
})
test('validateChat 400 when last is assistant or role unknown', () => {
  const r1 = validateChat([u('q'), a('r')])
  assert.deepEqual([r1.ok, !r1.ok && r1.status], [false, 400])
  const r2 = validateChat([{ role: 'system', content: 'hi' }])
  assert.deepEqual([r2.ok, !r2.ok && r2.status], [false, 400])
})
test('validateChat accepts valid history', () => {
  const r = validateChat([u('q'), a('r'), u('q2')])
  assert.equal(r.ok, true)
})

test('limiter allows max then blocks, then allows after window', () => {
  const l = makeLimiter(2, 1000)
  assert.equal(l('k', 0), true)
  assert.equal(l('k', 1), true)
  assert.equal(l('k', 2), false)
  assert.equal(l('other', 2), true)
  assert.equal(l('k', 1001), true)
})

function run(handler: (req: any, res: any) => Promise<void>, req: any) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const res: any = {
      code: 200,
      status(n: number) { this.code = n; return this },
      json(b: any) { resolve({ status: this.code, body: b }) },
    }
    handler(req, res)
  })
}
const env = { ANTHROPIC_API_KEY: 'k', ACCESS_TOKEN: 'tok' }
const good = (body: unknown = [u('hi')]) => ({ method: 'POST', headers: { authorization: 'Bearer tok' }, body })
function mk(ask = async () => 'ok', e: Record<string, string | undefined> = env) {
  const calls: any[] = []
  const handler = makeHandler({
    env: e,
    ask: async (m, o) => { calls.push([m, o]); return ask() },
    limiter: makeLimiter(20, 60000),
  })
  return { handler, calls }
}

test('handler 405 on GET', async () => {
  const { handler } = mk()
  assert.equal((await run(handler, { method: 'GET', headers: {} })).status, 405)
})
test('handler 401 without/with wrong token, no Claude call', async () => {
  const { handler, calls } = mk()
  assert.equal((await run(handler, { method: 'POST', headers: {}, body: [u('hi')] })).status, 401)
  assert.equal((await run(handler, { method: 'POST', headers: { authorization: 'Bearer no' }, body: [u('hi')] })).status, 401)
  assert.equal(calls.length, 0)
})
test('handler 400 on blank message, no Claude call', async () => {
  const { handler, calls } = mk()
  assert.equal((await run(handler, good([u('  ')]))).status, 400)
  assert.equal(calls.length, 0)
})
test('handler 200 returns reply and default model', async () => {
  const { handler, calls } = mk()
  const r = await run(handler, good())
  assert.deepEqual([r.status, r.body], [200, { reply: 'ok' }])
  assert.equal(calls[0][1].model, 'claude-haiku-5-5')
  assert.equal(calls[0][1].apiKey, 'k')
})
test('handler uses MODEL env', async () => {
  const { handler, calls } = mk(undefined, { ...env, MODEL: 'claude-sonnet-5-5' })
  await run(handler, good())
  assert.equal(calls[0][1].model, 'claude-sonnet-5-5')
})
test('handler 502 when upstream throws', async () => {
  const { handler } = mk(async () => { throw new Error('boom') })
  const r = await run(handler, good())
  assert.deepEqual([r.status, r.body], [502, { error: 'upstream' }])
})
test('handler 500 when env missing', async () => {
  const { handler } = mk(undefined, {})
  assert.equal((await run(handler, good())).status, 500)
})
test('handler 429 on 21st call', async () => {
  const { handler } = mk()
  for (let i = 0; i < 20; i++) assert.equal((await run(handler, good())).status, 200)
  assert.equal((await run(handler, good())).status, 429)
})

test('validateChat 400 when history starts with assistant or roles do not alternate', () => {
  for (const body of [[a('r'), u('q')], [u('q'), u('q2')]]) {
    const r = validateChat(body)
    assert.deepEqual([r.ok, !r.ok && r.status], [false, 400])
  }
})
