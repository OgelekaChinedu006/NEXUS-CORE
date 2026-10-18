# ΠΣXUS CΩRΣ

A modular, self-hosted WhatsApp bot built with Node.js, ES modules, Baileys `7.0.0-rc14`, and SQLite. The bot uses a dark, Sukuna-inspired identity, but every command is a real implementation with explicit permissions, validation, and persisted state.

## Status

- Foundation, connection lifecycle, message handling, permissions, moderation, and visual identity are implemented.
- All priority general, domain, security, and sovereign commands from the roadmap are implemented.
- Economy core commands and the utility category are implemented.
- The remaining catalogue is staged below. Unimplemented entries are not registered, so they never appear in `!shrine`.
- The automated suite covers parsing, permissions, database operations, formatting, connection backoff, handler behavior, priority commands, economy, and utility commands.

The bot has not been connected to a live WhatsApp account in this environment. QR/pairing behavior is implemented against Baileys `7.0.0-rc14` but should be verified with a real device before deployment.

## Requirements

- Node.js `>=22.5.0`
- npm
- A WhatsApp account for the bot
- Build tooling for `better-sqlite3` if a prebuilt binary is unavailable

## Installation

```bash
npm install
cp .env.example .env
```

Edit `.env` and set at least:

```dotenv
OWNER_JID=447700900123@s.whatsapp.net
PREFIX=!
```

`OWNER_JID` must be the owner's WhatsApp JID, not a display name. Display names are never trusted for authorization. Use the full international number followed by `@s.whatsapp.net` (for example `447700900123@s.whatsapp.net`).

Start the bot:

```bash
npm start
```

For development with restart-on-change:

```bash
npm run dev
```

## Authentication

### QR login

```dotenv
AUTH_METHOD=qr
```

Start the bot and scan the terminal QR from WhatsApp > Linked Devices.

### Pairing code

```dotenv
AUTH_METHOD=pairing
PAIRING_NUMBER=447700900123
```

The pairing code is printed once to the terminal and is not written to logs or disk. Enter it in WhatsApp > Linked Devices > Link with phone number.

### Session persistence

Credentials are stored in `SESSION_DIR` (default `data/session`). They survive restarts. The directory is excluded from Git. Do not commit or share it.

### Logout and conflicts

- A permanent logout (`loggedOut`) does not reconnect automatically. Delete the session directory only after understanding why the session was logged out, then restart and authenticate again.
- A replaced connection (`connectionReplaced`) stops the socket to prevent duplicate sessions. Shut down the other instance before restarting.
- Recoverable failures use bounded exponential backoff with jitter (`RECONNECT_*`). Reconnect loops and duplicate sockets are guarded.
- `SIGINT` and `SIGTERM` trigger graceful shutdown of the handler, socket, and database.

## Configuration

All configuration is read from environment variables. Defaults are defined in `config/config.js`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OWNER_JID` | empty | Verified owner JID. Owner commands remain disabled until set. |
| `PREFIX` | `!` | Global command prefix. Groups may override it in the database. |
| `DB_PATH` | `data/nexus-core.db` | SQLite database path. |
| `SESSION_DIR` | `data/session` | Baileys authentication state. |
| `LOG_LEVEL` | `info` | `silent`, `error`, `warn`, `info`, `debug`. |
| `TIMEZONE` | `UTC` | Timezone used in rendered timestamps. |
| `LOCALE` | `en-GB` | Locale used in rendered timestamps. |
| `AUTH_METHOD` | `qr` | `qr` or `pairing`. |
| `PAIRING_NUMBER` | empty | Phone number for pairing mode. |
| `RECONNECT_BASE_MS` | `3000` | First reconnect delay. |
| `RECONNECT_MAX_MS` | `60000` | Maximum reconnect delay. |
| `RECONNECT_MAX_ATTEMPTS` | `12` | Attempts before the manager stops. |
| `RATE_WINDOW_MS` | `10000` | Per-user rate-limit window. |
| `RATE_MAX_COMMANDS` | `8` | Commands allowed per window. |
| `EXECUTION_TIMEOUT_MS` | `20000` | Command execution timeout. |
| `GROUP_METADATA_TTL_MS` | `15000` | Group metadata cache lifetime. |
| `SPAM_WINDOW_MS` | `6000` | Anti-flood window. |
| `SPAM_THRESHOLD` | `7` | Messages that trigger anti-flood. |
| `SECURITY_ACTION_COOLDOWN_MS` | `30000` | Cooldown between security actions. |
| `MAX_MENTIONS` | `120` | Maximum mentions in a single summon or tag. |
| `PROFANITY_WORDS` | built-in list | Comma-separated additional profanity words. |
| `DEFAULT_WELCOME_TEXT` | built-in template | Override the default welcome template. |
| `DEFAULT_GOODBYE_TEXT` | built-in template | Override the default departure template. |
| `DEBUG` | `false` | Verbose debug flag. |

External providers:

| Variable | Purpose |
| --- | --- |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | OpenAI-compatible chat-completions provider. Commands are not yet registered. |
| `IMAGE_API_URL`, `IMAGE_API_KEY`, `IMAGE_MODEL` | OpenAI-compatible image-generation provider. Commands are not yet registered. |
| `WAIFU_API_URL` | Waifu.pics-compatible image source. |
| `TRANSLATE_API_URL`, `TRANSLATE_API_KEY` | LibreTranslate-compatible provider. Without a URL, MyMemory is used for explicit language pairs. |
| `WEATHER_TIMEOUT_MS` | Timeout for Open-Meteo geocoding and forecast requests. |

Missing credentials produce explicit "not configured" or "dormant" errors. The bot does not fabricate provider results.

## Permissions

Permissions are enforced centrally in `lib/permissions.js`.

| Permission | Meaning |
| --- | --- |
| `public` | Anyone may invoke the command. |
| `group` | Must be used inside a group. |
| `admin` | Sender must be a group admin (owner and sudo operators also pass). |
| `botAdmin` | The bot itself must be a group admin. |
| `sudo` | Sender must be the owner or a database-backed operator. |
| `owner` | Sender JID must equal `OWNER_JID`. |

Group admins are read from WhatsApp group metadata. The bot must be a group admin before it can kick, promote, demote, or change group settings. Moderation targets are validated against self, the bot, the owner, and the group founder.

Owners and operators bypass group security wards. Allies bypass wards but do not gain moderation powers.

## Security and moderation

- No shell execution and no arbitrary file access.
- Dangerous actions are permission-checked before execution.
- Group moderation checks the sender's privileges and the bot's admin status.
- Anti-link, anti-flood, and profanity filters delete offending messages, record warnings, and auto-ban at the configured warning limit when the bot can act.
- Warnings, moderation records, bans, operators, allies, group settings, and economy balances persist in SQLite.
- Welcome and departure messages are triggered by real participant events and use correct WhatsApp mentions.
- Incoming messages are deduplicated by message ID and pruned after 24 hours.
- Bot messages, status broadcasts, and newsletters are ignored.
- Command execution is rate-limited, cooldown-aware, timed out, and contained so one failure cannot crash the connection.

## Commands

Use `!shrine` for the live list and `!beg <command>` for usage, aliases, permissions, and cooldown. The menu is generated from the registry, so the advertised count is always the real count.

Implemented categories and commands (61 total):

- **General (13):** `shrine`, `beg`, `pulse`, `manifest`, `eternity`, `sovereign`, `territory`, `dominion`, `footprint`, `soulscan`, `vessel`, `oracle`, `sigil`
- **Domain control (16):** `cleave`, `silence`, `release`, `ascend`, `crush`, `dismantle`, `summon`, `shadowtag`, `condemn`, `pardon`, `domainlink`, `exile`, `liberate`, `lockdown`, `purge`, `edict`
- **Security (13):** `malevolent`, `profanity`, `overwhelm`, `vigil`, `judgment`, `welcome`, `departure`, `farewell`, `law`, `doctrine`, `inscribe`, `seal`, `unseal`
- **Sovereign (5):** `regime`, `edictor`, `reawaken`, `alliance`, `absence`
- **Economy (7):** `tribute`, `labor`, `excavate`, `treasury`, `transfer`, `hierarchy`, `wealth`
- **Utility (7):** `climate`, `lingua`, `equation`, `chronos`, `coordinates`, `shorten`, `inspect`

### Priority roadmap coverage

All commands in roadmap section E are implemented: general, domain control, security, and sovereign priorities. In particular, `farewell`, `law`, `doctrine`, `regime`, `edictor`, `reawaken`, `alliance`, and `absence` were added after the initial foundation.

### Staged catalogue

These planned commands are intentionally not registered yet. They do not appear in the menu.

| Category | Planned commands | Status |
| --- | --- | --- |
| AI | `incantation`, `genesis`, `nightmare`, `roastcurse`, `transmute`, `voicecurse`, `prophecy`, `revelation`, `dreamscape` | Not implemented. `AIService` provider exists; requires credentials. TTS/voice is not implemented. |
| Media | `manifestimage`, `relic`, `cursedtext`, `sever`, `unveil`, `resonance`, `echoes`, `inferno`, `specter`, `rift`, `visions`, `abyss`, `omnivision` | Not implemented. `MediaService` supports image generation, Wikimedia relic search, Wikipedia knowledge, and waifu/neko SFW images. Image credentials are required. |
| Fun | `mockery`, `apparition`, `confession`, `ordeal`, `soulbond`, `roast`, `favor`, `fate`, `omen`, `dicecurse`, `duel`, `trial`, `foresight`, `executioner`, `covenant`, `forbiddenknowledge`, `insight`, `verdict`, `fateweaver`, `wanted` | Not implemented. `confessions` storage exists. Overlaps with `oracle`, `sigil`, and `soulscan` must be resolved before registering duplicates. |
| Economy | `offering`, `transgression`, `reliquary`, `acquire`, `inventory`, `evolution` | Not implemented. Requires an item/inventory/level schema. Core balance commands are live. |
| Anime/Art | `waifu`, `neko`, `lore`, `vesselinfo`, `animeprophecy`, `distortion`, `simulation`, `hellfire`, `void`, `demonmark`, `phantomcode` | Not implemented. `AnimeService` supports Jikan anime/character search, and `MediaService` supports waifu/neko. |
| Utility | `climate`, `lingua`, `equation`, `chronos`, `coordinates`, `shorten`, `inspect` | Implemented. |

Overlapping behaviour is resolved by keeping one registered command per responsibility. For example, `law` stores group rules, while `edict` broadcasts a message; `doctrine` manages the warning threshold, while `judgment` reads the ledger.

## Adding a command

Create a file under `commands/<category>/` and default-export a command object. The registry loads nested directories and validates the metadata at startup.

```js
import { fullFrame } from '../../lib/formatter.js';

export default {
  name: 'example',
  aliases: [],
  description: 'Explain what the command really does.',
  category: 'general',
  usage: 'example <text>',
  permissions: ['public'],
  cooldownMs: 3000,
  async execute(ctx) {
    await ctx.reply(fullFrame('EXAMPLE', [ctx.argsText || 'No words given.']));
  },
};
```

Required fields: `name`, `description`, `category`, `usage`, `permissions`, and `execute`. `aliases` and `cooldownMs` are optional. Names must be lowercase and unique; alias conflicts and duplicate names reject the whole registry at startup.

Useful context fields include `ctx.sock`, `ctx.db`, `ctx.config`, `ctx.registry`, `ctx.services`, `ctx.senderJid`, `ctx.chatJid`, `ctx.args`, `ctx.argsText`, `ctx.targetJid`, `ctx.quoted`, `ctx.isOwner`, `ctx.isSudo`, `ctx.isAdmin`, `ctx.group`, `ctx.groupMeta`, and `ctx.reply()`.

Add tests under `tests/`. Do not register a command until it has real behaviour, validation, permissions, and error handling.

## Architecture

```text
index.js                    application entry point and shutdown
config/config.js            environment parsing and defaults
connection/connection.js    Baileys socket, auth state, reconnects
handler/handler.js          message parsing, dispatch, security filters
commands/                   command modules by category
lib/permissions.js          centralized authorization
lib/registry.js             command loading and validation
lib/formatter.js            frames, menus, templates
lib/database.js             SQLite schema and data operations
lib/moderation.js           warning and removal helpers
lib/helpers.js              JIDs, validation, timeouts, randomness
lib/calculator.js           safe expression evaluator
services/                   AI, media, anime, weather, translation, utilities
data/                       SQLite database and WhatsApp session (ignored)
tests/                      Node test runner suite
```

## Database

SQLite is initialized automatically at `DB_PATH`. The schema includes:

- `settings` for global prefix, absence mode, and notices
- `groups` for per-group prefix, welcome/departure rites, laws, warnings, and wards
- `warnings` and `moderation` for persistent records
- `operators`, `global_bans`, `group_bans`, and `group_allies`
- `users` and `group_activity` for activity tracking
- `economy` for balances and claim cooldowns
- `processed_messages` for deduplication
- `confessions`, reserved for the staged confession command
- `audits` for owner-level audit records

## Tests

```bash
npm test
```

The suite uses the built-in Node test runner and an in-memory SQLite database. It does not connect to WhatsApp or external services.

Current coverage:

- parsing, wrappers, quoted messages, mentions, and prefixes
- permission checks and moderation-target validation
- database settings, groups, warnings, moderation, bans, operators, allies, activity, economy, transfers, deduplication, and stats
- formatter frames, menus, templates, and progress bars
- bounded reconnect backoff and connection shutdown
- handler ignore rules, deduplication, command context, permissions, timeouts, anti-link behavior, ally bypass, absence mode, rate limits, and participant events
- command metadata, live menu counts, priority command coverage, sovereign commands, utility commands, and economy commands

## Troubleshooting

**The bot prints no QR code.** Check `LOG_LEVEL`, confirm `AUTH_METHOD=qr`, and ensure the session directory is writable. If a previous session exists, the bot may already be authenticated.

**The bot says reauthentication is required.** The WhatsApp session was logged out. Remove `SESSION_DIR` only after confirming the logout, then restart and authenticate.

**Another session owns the connection.** Another process is using the same credentials. Stop it and restart only one instance.

**Admin commands fail.** The sender must be a group admin, and for actions that modify the group the bot must also be a group admin. Verify `botAdmin` in `!territory`.

**Owner commands are sealed.** `OWNER_JID` is missing or does not match the sender's real JID. Display names are ignored.

**`better-sqlite3` fails to install.** Install a C/C++ build toolchain and Python, then reinstall dependencies.

**External utility commands fail.** Weather and translation providers require network access and may rate-limit. Set the relevant timeout variables and provider URLs. AI and image commands are not yet registered.

## Progress checklist

- [x] Dependencies, scripts, configuration, safe environment handling
- [x] Entry point, SQLite initialization, Git exclusions
- [x] Baileys `7.0.0-rc14`, persistent auth, QR/pairing, lifecycle, backoff, logout handling, graceful shutdown
- [x] Message parsing, prefix/args, mentions, quotes, groups/direct, ignore rules, deduplication, containment, rate limits, timeouts
- [x] Modular registry, metadata validation, permissions, dynamic `!shrine`, `!beg`, accurate menu
- [x] Priority general, domain, security, and sovereign commands
- [x] Owner JID verification, moderation evidence, target validation, persisted settings, welcome/departure events
- [x] Identity, themed frames, footer, templates
- [x] Utility category and economy core
- [x] Automated tests and README
- [ ] AI, media, fun, advanced economy, anime/art catalogues
- [ ] Live WhatsApp device verification in a deployment environment

## License

MIT
