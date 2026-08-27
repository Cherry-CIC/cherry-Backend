# cherry-help

`cherry-help` is an internal Slack bot for cherry volunteers. It answers simple questions from approved cherry docs only, cites the source, and refuses requests that involve secrets, personal data, admin bypasses or unsafe changes.

The bot is intentionally small. It is retrieval-only for the MVP, so it does not guess when the docs do not contain the answer.

## Slack setup

The Slack app should use Socket Mode. This lets the worker receive mentions and direct messages without a public HTTP endpoint.

Expected Slack app setup:

- App name: `cherry volunteer help`
- Slash command: `/cherryhelp`
- Socket Mode: enabled
- App-level token: `connections:write`
- Event subscriptions: `app_mention` and `message.im`
- Bot scopes: `app_mentions:read`, `chat:write`, `commands`, `im:history`, `im:read`, `im:write`

Reinstall the Slack app after changing scopes or event subscriptions.

## Environment variables

Set these in Railway variables for production. Use `.env` only for local development, and never commit it.

```env
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
GITHUB_TOKEN=
GITHUB_REPOS=
NOTION_TOKEN=
NOTION_PAGE_IDS=
BOT_MODE=retrieve_only
ALLOWED_CHANNEL_IDS=
VOLUNTEER_LEAD_LABEL=the volunteer lead
NODE_ENV=production
```

`GITHUB_REPOS` accepts comma-separated values such as `owner/repo` or `owner/repo#main`.

`ALLOWED_CHANNEL_IDS` is optional. Leave it blank to answer in any channel where the bot is present. Set comma-separated Slack channel IDs to restrict replies.

## Approved sources

The bot indexes:

- `content/volunteer-faq.md`
- `README.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
- `docs/**`
- `.devcontainer/**`
- Notion pages listed in `NOTION_PAGE_IDS`

It skips `.env` files, build output, dependencies and unrelated source files. Do not put secrets, donor data, customer data or private Slack content in approved docs.

Retrieval order is:

1. FAQ
2. GitHub or local docs
3. Notion pages

## Run locally

From this directory:

```sh
npm ci
cp .env.example .env
npm run build-index
npm run build
npm test
npm run dev
```

Fill `.env` with local test values before starting the bot. Do not use production tokens on a shared machine.

## Railway deployment

Railway should build from:

```text
bots/cherry-help
```

Recommended build command:

```sh
npm ci --include=dev && npm run build && npm run build-index
```

Start command:

```sh
npm start
```

The service can stay unexposed because Socket Mode does not need an inbound public URL.

## Slash command behaviour

`/cherryhelp <question>` replies ephemerally by default. Mentions reply in the same thread when possible. Direct messages reply in the DM.

When the bot cannot find a reliable approved source, it says:

```text
I do not know from the approved cherry docs yet. Please ask the volunteer lead, and we can add the answer to the volunteer FAQ afterwards.
```

## Improving the FAQ

Add volunteer-ready answers to `content/volunteer-faq.md`. Keep each answer short, factual and easy to check. Prefer plain language. Always spell cherry with a lowercase `c`.

After changing approved docs, rebuild the index:

```sh
npm run build-index
```

## Security notes

Never commit `.env`, Slack tokens, GitHub tokens, Notion tokens, donor data, customer data or private Slack messages. Rotate any secret that has been pasted into chat, screenshots, logs or docs.
