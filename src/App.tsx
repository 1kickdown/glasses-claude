import { useEffect, useRef, useState } from 'react'
import { ApiError, sendChat, type Msg } from './lib/api.ts'
import { store } from './lib/storage.ts'
import { speak, stopSpeaking } from './lib/speech.ts'

const ERRORS = { auth: 'Неверный токен', rate: 'Слишком часто', network: 'Нет связи', server: 'Ошибка сервера' }

export default function App() {
  const [token, setToken] = useState<string | null>(() => {
    try {
      const u = new URL(window.location.href)
      const t = u.searchParams.get('t')
      if (t) {
        store.set('token', t)
        u.searchParams.delete('t')
        window.history.replaceState(null, '', u.pathname + u.search + u.hash)
        return t
      }
    } catch { /* ignore */ }
    return store.get('token') || null
  })
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [voice, setVoice] = useState(() => store.get('voice') !== 'off')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const submitRef = useRef<(v: string) => void>(() => {})

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages, busy, error])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onChange = () => submitRef.current(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [token])

  if (!token) {
    return (
      <div className="screen">
        <div className="title">Введите токен доступа</div>
        <input
          className="field"
          type="text"
          placeholder="Токен"
          onChange={(e) => {
            const v = e.target.value.trim()
            if (v) { store.set('token', v); setToken(v) }
          }}
        />
      </div>
    )
  }

  async function submit(value: string, history: Msg[] = messages) {
    const q = value.trim()
    if (!q || busy || lock.current) return
    lock.current = true
    const next: Msg[] = [...history, { role: 'user', content: q }]
    setMessages(next)
    setText('')
    setError('')
    setBusy(true)
    stopSpeaking()
    try {
      const reply = await sendChat(next, token!)
      setMessages([...next, { role: 'assistant', content: reply }])
      if (voice) speak(reply)
    } catch (e) {
      const kind = e instanceof ApiError ? e.kind : 'server'
      if (kind === 'auth') { store.set('token', ''); setToken(null) }
      setError(ERRORS[kind])
    } finally {
      setBusy(false)
      lock.current = false
    }
  }

  submitRef.current = (v: string) => { submit(v) }

  return (
    <div className="screen">
      <header className="bar">
        <span className="brand">✺ Claude</span>
        <span className="status">{busy ? 'Thinking' : ''}</span>
      </header>
      <main className="chat">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'bubble me' : 'bubble ai'}>{m.content}</div>
        ))}
        {error && <div className="err">{error}</div>}
        <div ref={endRef} />
      </main>
      <footer className="compose">
        <input
          ref={inputRef}
          className="field"
          value={text}
          placeholder="Спросите Claude"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(text) }}
        />
        <div className="row">
          <button onClick={() => submit(text)}>Отправить</button>
          <button onClick={() => { stopSpeaking(); setMessages([]); setError('') }}>+ New</button>
          <button onClick={() => { const v = !voice; setVoice(v); store.set('voice', v ? 'on' : 'off'); if (!v) stopSpeaking() }}>
            Voice {voice ? 'on' : 'off'}
          </button>
        </div>
      </footer>
    </div>
  )
}
