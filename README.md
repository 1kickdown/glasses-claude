# Claude на Meta Ray-Ban Display

Web App для очков: чат с Claude (ввод через системный композер, ответ на экране + озвучка).

## Деплой
1. Залить репозиторий на GitHub, импортировать в Vercel (Framework: Vite).
2. В Vercel → Settings → Environment Variables: `ANTHROPIC_API_KEY`, `ACCESS_TOKEN` (случайная строка 32+ символов), необязательно `MODEL` (по умолчанию `claude-haiku-5-5`).
3. Проверка: `curl -X POST https://<app>.vercel.app/api/chat` без токена даёт 401.
4. В приложении Meta AI: Devices → Display glasses → App connections → Web apps → Add a web app (имя + URL).
5. На очках открыть приложение, один раз ввести токен.

## Разработка
`npm install`, `npm run dev`, `npm test`, `npm run typecheck`.
