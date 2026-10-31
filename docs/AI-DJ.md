# AI DJ

A chat in Wavelength that knows your library. Ask it for a playlist, a mood, "more like this", or the albums you're
missing, and it searches, plays, queues and saves for you. It runs on the **Wavelength Hub** with your AI provider's
API key; the app never sees the key.

- [Setting it up (admins)](#setting-it-up-admins)
- [Using it](#using-it)
- [Costs and limits](#costs-and-limits)
- [Kids](#kids)
- [How it works](#how-it-works)
- [API](#api)
- [Adding a provider](#adding-a-provider)
- [Not yet](#not-yet)

## Setting it up (admins)

Everything about the DJ is kept on the Hub and changed in the app under **Settings → AI DJ** (Hub admins only).

1. **Get an API key.** Sign in at [console.anthropic.com](https://console.anthropic.com), open **API keys**, and
   create one. Set a monthly spend limit there too: it's a backstop to the limits in Wavelength.
2. **Save the key.** In Wavelength, open **Settings → AI DJ**, paste it under **Provider and key** and press
   **Save key**. The key goes to the Hub, which keeps it sealed (AES-256-GCM, like the other server logins) and
   never sends it to a device. The page only shows its last four characters. Press **Test** to check the key and
   the model work; it doesn't use any tokens.
3. **Pick a model.** The default is **Claude Opus 5.5** (best picks, costs most). **Claude Sonnet 5.5** is about
   half the price and nearly as good; **Claude Haiku 5.5** is very cheap and fine for simple asks. **How hard it
   thinks** (effort) trades quality for cost and speed; *medium* is a good start. **Other model id…** takes any
   model id; enter its prices so costs are counted.
4. **Set limits.** A **household limit** per month, and the **limit for each person** that people get when you turn
   them on (default $5). Leave a box empty for no limit.
5. **Turn it on.** Tick **Turn on the AI DJ for this Hub**, then switch it on for each person under **Who can use
   it** (or **Turn on for all grown-ups**). Each person's monthly limit can be changed there.

The DJ shows up in the app's menu (**AI DJ**, under Library on phones) for the people it's on for, within half an
hour, or straight away after reopening the app.

Turning the Hub switch off stops it for everyone at once; removing the key does too.

**Behind a reverse proxy** (Nginx Proxy Manager and friends): one message can take a minute or more while the DJ
works, and many proxies cut a request off after 60 seconds. Give the Hub's proxy host a longer read timeout, e.g.
in NPM → the Hub's proxy host → **Advanced**: `proxy_read_timeout 300s;`

### Advanced

- **When the model declines an answer, let Anthropic try another model.** On Claude Opus 5.5 and Sonnet 5.5 the Hub
  asks Anthropic to retry a declined answer on another model (`fallbacks: "default"`). On by default.
- **API address.** For a gateway or proxy that speaks the Anthropic API. Empty = Anthropic's own. Server-side
  fallback is off when an address is set.

## Using it

Open **AI DJ** and type, or tap one of the ideas. Things it's good at:

- "Make me a 25-song road trip playlist" (it picks songs, checks which you have, and saves a playlist that follows
  you to every device: **Open the playlist** jumps to it).
- "Play something like what I listened to this week" / "Queue up some chill music for dinner".
- "Play the new Fontaines D.C. album next" (play now, next, or at the end of the queue).
- "Which Radiohead albums am I missing?" then "Get OK Computer": it compares Deezer's discography with your library,
  and asks the Hub for the albums you choose. With Autodownload they download straight away; otherwise they wait in
  the requests queue for an admin, as always.

Chats are kept on the Hub per person: pick an earlier one from the list at the top, or **New chat**. A chat holds 40
messages; then start a new one. **This month** under the box shows what you've used of your allowance.

## Costs and limits

The Hub counts the tokens of every call and works out the cost from the prices in the settings (US$ per million
tokens: input, output, cache read, cache write). These are estimates; your provider's bill is the real number.
List prices built in (October 2026):

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| Claude Opus 5.5 | $4 | $20 | $0.20 | $5 |
| Claude Sonnet 5.5 | $2 | $10 | $0.20 | $2.50 |
| Claude Haiku 5.5 | $0.10 | $0.50 | $0.01 | $0.125 |

Change a price in **Settings → AI DJ → Model** when your provider's prices change.

A message usually takes 2 to 6 model calls (the DJ searches, checks songs, then answers). The system prompt,
tools and earlier turns are cached, so later steps of a chat read most of it at the cache price. Sonnet 5.5 costs
about half of Opus 5.5 for the same chat, and a lower effort uses fewer tokens. After a few chats, **Settings →
AI DJ → Spending** shows what your household's use really costs, by model.

Limits are checked before every call, per calendar month (the Hub's time zone):

- **Each person's limit**: when it's used up, the DJ says so and stops for them until the 1st.
- **Household limit**: stops it for everyone.

A call already running finishes, so a limit can be passed by one call.

## Kids

Kid profiles are off unless an admin turns them on. When on, the DJ is told the listener is a child and keeps to
family-friendly music; the app also drops anything the kid filters hide (explicit songs, flags) from what the DJ
sees and plays, and the Hub leaves explicit releases out of Deezer results. A kid's download requests go to their
parents and the admins, as with the Request button.

## How it works

```
App (views/DJ.tsx, lib/dj.ts)            Hub (hub/src/dj/, routes/dj.ts)             Anthropic
  message ───────────────────────────▶  POST /api/dj/chat
                                         agent loop: call the model ───────────────▶  Messages API
                                         Hub tools run here          ◀───────────────  tool calls
  ◀── { status: 'tools', calls } ──────  app tools are handed back
  run them (search, play, save)
  results ───────────────────────────▶  POST /api/dj/chats/:id/tools
                                         …until the model answers
  ◀── { status: 'done', reply } ───────
```

- **Why split the tools.** The music lives with the app: each device reaches Navidrome and Plex with its own
  logins (or the Hub's relay), plays the songs and keeps the person's playlists. So **app tools** run in the app:
  `search_library`, `find_songs`, `library_albums`, `now_playing`, `play`, `save_playlist`. **Hub tools** run on
  the Hub: `listening_stats` (the plays table Rewind uses), `deezer_search`, `artist_discography`,
  `similar_artists`, `artist_top_songs` and `request_download` (the same code as `POST /api/requests`, at most 10
  per message).
- **Refs.** Songs and albums the app finds are given short refs (`t4`, `a2`) that the model passes back to `play` and
  `save_playlist`. The app keeps them per chat while it's open; after a restart the DJ searches again.
- **The loop** (`hub/src/dj/agent.ts`): up to 12 model calls per message; the last one must answer without tools.
  Messages are stored exactly as the provider returned them and only appended to, so thinking blocks and the prompt
  cache stay valid. A declined answer (`refusal`) or a cut-off tool call is never run. If the provider fails, the
  chat is saved as it was and the next message carries on from there. If the app is closed while the Hub waits for
  it, reopening the chat finishes the calls.
- **Model calls** (`hub/src/dj/provider.ts`): the official `@anthropic-ai/sdk`, Messages API, adaptive thinking with
  the chosen effort, automatic prompt caching, `max_tokens` 16000, and server-side refusal fallback on the models
  that support it.
- **Storage** (`hub/src/db.ts` migration): `dj_access` (switch and limit per person), `dj_usage` (every call:
  model, tokens, cost), `dj_conversations` (the chats). Settings and the sealed key are in `hub_settings` under
  `dj.settings`. All of it is in Hub backups.

## API

All need a device token. Listener routes answer 403 with the reason when the DJ is off for the caller.

| Method | Path | |
|---|---|---|
| GET | `/api/dj` | `{ available, reason, model, spent, limit }`, for anyone signed in |
| GET | `/api/dj/chats` | your chats, newest first |
| GET | `/api/dj/chats/:id` | `{ chat, messages: [{ role, text, tools? }], calls, full }`; `calls` = tool calls waiting for the app |
| DELETE | `/api/dj/chats/:id` | delete a chat |
| POST | `/api/dj/chat` | `{ chatId?, message }` → `{ chat, status: 'done' \| 'tools', reply, calls?, full?, spent, limit }`; 402 when a limit is used up |
| POST | `/api/dj/chats/:id/tools` | `{ results: [{ id, content, isError? }] }` → same as above |
| GET | `/api/admin/dj` | settings (never the key, only `key: { set, hint }`), models and prices, people with their switch, limit and spend, this month's spend by model and day |
| PUT | `/api/admin/dj` | `{ enabled?, provider?, model?, effort?, baseUrl?, fallback?, prices?, householdLimit?, defaultUserLimit?, apiKey? }`; `apiKey: ''` removes it |
| PUT | `/api/admin/dj/users/:userId` | `{ enabled?, monthlyLimit? }` (`null` = no limit) |
| POST | `/api/admin/dj/test` | checks the key and model, no tokens used |

Admin routes need `keys.manage` (admins). Changes are in the audit log (`dj.settings`, `dj.access`).

## Adding a provider

1. Write a `ProviderFactory` in `hub/src/dj/provider.ts`: `create()` takes the system prompt, tools and messages
   and returns the content, stop reason, model and token usage; `test()` checks the key without spending.
2. Add its name to `PROVIDERS` in `hub/src/dj/settings.ts`, its models and prices to `MODELS`, and pick the factory
   by `settings.provider` in `app.ts`.
3. Stored chats are in the provider's own message format, so a chat started on one provider can't go on with
   another: clear chats (or start new ones) when switching.

## Not yet

Ideas for later, roughly in order:

- Stream the reply word by word (the reply arrives whole now, with a progress line while it works).
- An OpenAI-compatible provider (OpenAI, a local Ollama).
- Let the DJ add songs to an existing playlist and to household playlists.
- Remember what each person likes between chats.
- A daily cost chart on the admin page (the API already returns `month.byDay`).
- Long chats: summarise older turns (compaction) instead of closing the chat at 40 messages.
