import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendChat, ApiError } from './api.ts'
import { store } from './storage.ts'
import { speak, stopSpeaking } from './speech.ts'

const msgs = [{ role: 'user' as const, content: 'hi' }]
function fakeFetch(status: number, body: unknown = {}) {
  return (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch
}
async function kind(p: Promise<unknown>) {
  try { await p } catch (e) { return e instanceof ApiError ? e.kind : 'other' }
  return 'none'
}

test('sendChat returns reply on 200 and sends bearer', async () => {
  let seen: any
  const f = (async (url: string, init: any) => { seen = [url, init]; return { ok: true, status: 200, json: async () => ({ reply: 'yo' }) } }) as unknown as typeof fetch
  assert.equal(await sendChat(msgs, 'tok', f), 'yo')
  assert.equal(seen[0], '/api/chat')
  assert.equal(seen[1].headers.Authorization, 'Bearer tok')
})
test('sendChat maps errors', async () => {
  assert.equal(await kind(sendChat(msgs, 't', fakeFetch(401))), 'auth')
  assert.equal(await kind(sendChat(msgs, 't', fakeFetch(429))), 'rate')
  assert.equal(await kind(sendChat(msgs, 't', fakeFetch(500))), 'server')
  assert.equal(await kind(sendChat(msgs, 't', (async () => { throw new Error('x') }) as unknown as typeof fetch)), 'network')
})
test('store swallows localStorage exceptions', () => {
  ;(globalThis as any).localStorage = { getItem() { throw new Error('no') }, setItem() { throw new Error('no') } }
  assert.equal(store.get('a'), null)
  assert.doesNotThrow(() => store.set('a', 'b'))
  delete (globalThis as any).localStorage
  assert.equal(store.get('a'), null)
})
test('speak is a no-op without speechSynthesis', () => {
  assert.doesNotThrow(() => speak('hello'))
  assert.doesNotThrow(() => stopSpeaking())
})
