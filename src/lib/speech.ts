export function speak(text: string): void {
  try {
    const s = (globalThis as any).speechSynthesis
    const U = (globalThis as any).SpeechSynthesisUtterance
    if (!s || !U || !text) return
    s.cancel()
    s.speak(new U(text))
  } catch { /* ignore */ }
}

export function stopSpeaking(): void {
  try { (globalThis as any).speechSynthesis?.cancel() } catch { /* ignore */ }
}
