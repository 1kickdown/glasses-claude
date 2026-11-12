# Claude on Meta Ray-Ban Display

A tiny web app that lets you chat with [Claude](https://www.anthropic.com/claude) on **Meta Ray-Ban Display** glasses. You speak (or type), Claude answers in a few words on the 600×600 display, and the answer can be read aloud.

It runs as a **Web App** on the glasses (plain HTML/JS served over HTTPS), with a small serverless function that calls the Claude API so your API key never reaches the browser.

> Unofficial community project. Not affiliated with or endorsed by Meta or Anthropic.

## Features

- **Voice or text input** through the glasses' built-in system composer (dictation / on-screen input).
- **Short answers** tuned for a tiny display: plain text, about 40 words, no markdown or emoji.
- **Voice output** with a "Voice on/off" toggle (uses the browser's `speechSynthesis`).
- **Private by design**: every request needs your personal access token; the Anthropic API key lives only in server environment variables.
- **Cheap**: defaults to `claude-haiku-5-5`. A typical question costs a fraction of a cent.
- Basic abuse protection: token check, input limits, per-token rate limit (20 requests/minute).
- Optional **WhatsApp bot** (text and photos), see [WhatsApp bot](#whatsapp-bot-optional).

## How it works

```
Glasses (Web App)  ──HTTPS──▶  /api/chat (Vercel function)  ──▶  Claude API
   React + Vite                 token check, validation,
   600×600 UI                   rate limit, system prompt
```

- `src/` — React + Vite + TypeScript frontend (chat UI, token storage, speech).
- `api/chat.ts` — serverless endpoint for the chat (auth, validation, rate limit, Claude call).
- `api/whatsapp.ts` — optional WhatsApp Cloud API webhook.
- `docs/superpowers/` — design specs and implementation plans.

## Requirements

- Meta Ray-Ban Display glasses with a firmware / Meta AI app version that supports Web Apps and the system text composer (firmware v127+ and Meta AI app v272+ at the time of writing).
- Developer Mode enabled in the Meta AI app (Settings → App Info → tap the version five times).
- An [Anthropic API key](https://console.anthropic.com/) with some credit ($5 goes a long way). The API is billed separately from a claude.ai subscription. Set a monthly spend limit in the console.
- A [Vercel](https://vercel.com/) account (the free Hobby plan is enough) and a GitHub account.

## Deploy

1. Fork or clone this repository and push it to your own GitHub account.
2. In Vercel: **Add New → Project**, import the repository (framework preset: **Vite**).
3. Add environment variables (Production and Preview):

   | Name | Description |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | Your Anthropic API key (`sk-ant-…`) |
   | `ACCESS_TOKEN` | A long random string you invent, e.g. `openssl rand -hex 16` |
   | `MODEL` | Optional. Defaults to `claude-haiku-5-5`; e.g. `claude-sonnet-5-5` for better answers |

4. Deploy. Check that the endpoint is protected: a `POST https://<your-app>.vercel.app/api/chat` without a token must return `401`.

## Add it to the glasses

1. In the Meta AI app: **Devices → Display glasses → App connections → Web apps → Add a web app**.
2. Name: `Claude`. URL: `https://<your-app>.vercel.app/?t=<ACCESS_TOKEN>`.

   The `?t=` parameter saves the token on first launch, so you never have to dictate it on the glasses. Keep this URL private: anyone who has it can use your Claude credit. To rotate the token, change `ACCESS_TOKEN` in Vercel, redeploy, and update the URL.
3. Open the app on the glasses, tap the input field, dictate your question and confirm. Use **Send**, **+ New** and **Voice on/off** as needed.

## Local development

```bash
npm install
npm run dev        # frontend dev server
npm test           # unit tests (Node's built-in test runner, no extra dependencies)
npm run typecheck
```

Tests cover the token check, request validation, rate limiting, the chat handler, the WhatsApp webhook logic and the frontend helpers. They use `node:test` with Node 22's TypeScript support (`--experimental-strip-types`). Test the UI with the Meta Ray-Ban Display simulator Chrome extension or a plain browser at 600×600.

## WhatsApp bot (optional)

`api/whatsapp.ts` is a webhook for the WhatsApp Cloud API: you message a WhatsApp number from the glasses, and Claude replies in the chat. Text messages and photos are supported (photos are analyzed with Claude's vision); voice notes are not transcribed.

Extra environment variables: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `ALLOWED_NUMBER` (your number, digits only with country code). Set the webhook URL in Meta to `https://<your-app>.vercel.app/api/whatsapp` and subscribe to the `messages` field. Only `ALLOWED_NUMBER` gets answers, request signatures are verified, and duplicate deliveries are ignored.

**Heads-up:** Meta requires **business verification** before an account can send WhatsApp messages (a new test account is otherwise "restricted/locked", error 131031). This needs a real, registered business, so the bot may not be usable for a purely personal setup. The code is tested but has not been verified against a live, verified account.

## Limitations

- Web Apps on the display have **no camera or raw microphone access**; photos require a native companion app (the Wearables Device Access Toolkit, still in developer preview, and not available for publishing) or the WhatsApp route above.
- Handwriting input and some Meta AI features are region-limited.
- Conversation history lives in the page's memory and is lost on reload.
- Rate limiting and message de-duplication are in-memory and best-effort on serverless.

## Security notes

- Never commit `.env` files, API keys or tokens (they are git-ignored here).
- Keep your Anthropic spend limit low and rotate `ACCESS_TOKEN` if the URL leaks.

## License

No license has been chosen yet. Add a `LICENSE` file (for example MIT) if you want others to reuse the code.
