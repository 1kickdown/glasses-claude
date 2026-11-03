# Claude on Display Glasses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Vercel-hosted Web App that lets the owner chat with Claude on Meta Ray-Ban Display (text input via system composer, answer on screen plus spoken).

**Architecture:** One Vercel project: Vite+React+TS frontend and a same-origin serverless function `api/chat.ts` that authenticates with a bearer token and calls the Claude API. Pure logic (validation, auth, rate limit) lives in `api/_lib/` and is unit-tested with Vitest.

**Tech Stack:** Vite, React, TypeScript, Vitest, `@anthropic-ai/sdk`, Vercel Functions. Meta UI Toolkit (`@wearables-ui-toolkit/mrbd`) only if it installs cleanly; otherwise plain CSS (verify via Meta docs MCP / llms.txt before use).

**Spec:** `docs/superpowers/specs/2026-11-03-claude-on-display-glasses-design.md`

## Global Constraints

- Display 600x600, black background; first load < 300 KB, < 15 requests.
- `<meta name="mrbd-web-app-capable" content="yes">` in `index.html`.
- API key only in env `ANTHROPIC_API_KEY`; access token in env `ACCESS_TOKEN`; optional `MODEL` (default `claude-haiku-5-5`).
- Answers: user's language, about 40 words, no markdown/emoji.
- `localStorage` access always in try/catch; page works without it.
- Frontend calls only same-origin `/api/chat`.

## Review Focus

- Empty or whitespace-only message: rejected 400, no Claude call.
- Huge message or history (over limits): rejected 413/400, no Claude call.
- Missing/wrong token (incl. different length): 401, constant-time compare, no crash.
- Claude API error or timeout: client shows short error, input stays usable.
- `localStorage` throws / `speechSynthesis` missing: app still works, no voice.

---

### Task 1: Scaffold and tooling

**Files:** Create `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx` (placeholder), `.gitignore`, `vercel.json`, `.env.example`.

**Interfaces:** Produces: `npm run dev`, `npm run build`, `npm test` (Vitest) scripts.

- [ ] **Step 1:** Scaffold Vite React-TS in the repo root; add `vitest`, `@anthropic-ai/sdk`, `@vercel/node`.
- [ ] **Step 2:** Add the meta tag, black body, viewport 600x600-friendly CSS reset.
- [ ] **Step 3:** `.env.example` lists the three env vars; `.gitignore` excludes `.env*` (except example), `node_modules`, `dist`.
- [ ] **Step 4:** Run `npm run build` and `npm test -- --run`. Expected: build succeeds, vitest reports no tests (exit 0 with `--passWithNoTests`).
- [ ] **Step 5:** Commit.

### Task 2: Backend pure logic (TDD)

**Files:** Create `api/_lib/auth.ts`, `api/_lib/validate.ts`, `api/_lib/ratelimit.ts`; Test `api/_lib/*.test.ts`.

**Interfaces:**
- Produces: `checkToken(header: string | undefined, expected: string): boolean` (Bearer parse, `crypto.timingSafeEqual` with length guard)
- `validateChat(body: unknown): { ok: true; messages: Msg[] } | { ok: false; status: 400 | 413; error: string }` where `Msg = { role: 'user' | 'assistant'; content: string }`; limits: at most 20 messages, each content at most 2000 chars, last message must be `user` and non-blank, roles alternate-valid.
- `makeLimiter(max: number, windowMs: number): (key: string, now?: number) => boolean` (true = allowed).

- [ ] **Step 1:** Write failing tests: `checkToken` accepts `Bearer abc` for `abc`; rejects missing header, wrong token, shorter/longer token, non-Bearer scheme. `validateChat` rejects `''`, `'   '`, non-array, 21 messages (413), 2001-char content (413), last role assistant (400), unknown role (400); accepts a valid 3-message history. Limiter allows `max` calls then blocks, and allows again after `windowMs`.
- [ ] **Step 2:** Run `npm test -- --run`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement the three modules to the signatures above.
- [ ] **Step 4:** Run tests. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: `/api/chat` handler (TDD)

**Files:** Create `api/chat.ts`, `api/_lib/claude.ts`; Test `api/chat.test.ts`.

**Interfaces:**
- Consumes: Task 2 modules.
- Produces: `askClaude(messages: Msg[], opts: { apiKey: string; model: string }): Promise<string>` (non-streaming `messages.create`, `max_tokens: 300`, system prompt per Global Constraints). Default export `handler(req, res)` for Vercel: POST only (405 otherwise); 401 on bad token; limiter 20 req/min per token → 429; validate → call `askClaude` → `{ reply: string }`; Claude failure → 502 `{ error: 'upstream' }`; missing env → 500.

- [ ] **Step 1:** Failing tests with `askClaude` mocked: 405 on GET; 401 without/with wrong token and `askClaude` not called; 400 on blank message with no call; 200 returns `{reply}` on valid call and passes the env model (default `claude-haiku-5-5`); 502 when `askClaude` throws; 429 on the 21st call.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement `claude.ts` (Anthropic SDK) and `chat.ts`.
- [ ] **Step 4:** Run tests, expect PASS.
- [ ] **Step 5:** Commit.

### Task 4: Frontend chat UI (TDD for logic)

**Files:** Create `src/lib/api.ts`, `src/lib/storage.ts`, `src/lib/speech.ts`, `src/App.tsx`, `src/App.css`; Test `src/lib/*.test.ts`.

**Interfaces:**
- `sendChat(messages: Msg[], token: string): Promise<string>` POSTs `/api/chat` with Bearer; throws `ApiError('auth' | 'rate' | 'network' | 'server')` mapped from 401 / 429 / fetch failure / other.
- `store.get(key): string | null`, `store.set(key, value): void` (both swallow exceptions).
- `speak(text: string): void` and `stopSpeaking(): void` (no-op if `speechSynthesis` undefined).

- [ ] **Step 1:** Failing tests: `sendChat` maps 401→`auth`, 429→`rate`, rejected fetch→`network`, 500→`server`, 200→reply string; `store` returns null and does not throw when `localStorage` throws; `speak` does not throw when `speechSynthesis` is undefined.
- [ ] **Step 2:** Run, expect FAIL.
- [ ] **Step 3:** Implement libs, then `App.tsx`: if no token stored, token-entry screen (one text input); else chat screen with bubbles, "Thinking" status, text input (tapping it opens the system composer; send on `change`/Enter), `+ New`, `Voice on/off` toggle (persisted), error line with short Russian messages ("Неверный токен", "Слишком часто", "Нет связи", "Ошибка сервера"). Spoken reply when Voice on.
- [ ] **Step 4:** Run tests, expect PASS; `npm run build`; confirm gzipped JS < 300 KB.
- [ ] **Step 5:** Commit.

### Task 5: Simulator check and local end-to-end

**Files:** Modify as needed (fixes only).

- [ ] **Step 1:** Run `vercel dev` (or `vite` + a local proxy to the handler) with a fake `ACCESS_TOKEN` and a stubbed Claude; screenshot the 600x600 view with Playwright; check layout (no overflow, readable font).
- [ ] **Step 2:** If the Meta simulator extension or docs MCP show UI-Toolkit requirements that differ, adjust CSS/markup.
- [ ] **Step 3:** Commit fixes.

### Task 6: Deploy and connect to glasses (needs the user)

**Files:** Create `README.md` (deploy and glasses steps in Russian).

- [ ] **Step 1:** Create GitHub repo, push (requires user's GitHub authorization).
- [ ] **Step 2:** Import to Vercel; user sets `ANTHROPIC_API_KEY`, `ACCESS_TOKEN` (random 32+ chars), optional `MODEL`.
- [ ] **Step 3:** Smoke test: `curl -X POST <url>/api/chat` without token returns 401; with token returns a reply.
- [ ] **Step 4:** On the phone: Meta AI app → Devices → Display glasses → App connections → Web apps → Add (name, URL); open on the glasses, enter token, ask a question.
- [ ] **Step 5:** Commit README.
