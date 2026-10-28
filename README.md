# Commentum v2 🚀

Modern, high-performance community commenting, social gamification, and notification platform for [AnymeX](https://github.com/RyanYuuki/AnymeX) and multiservice media clients.

Built with **Hono** running on **Cloudflare Workers**, **Cloudflare D1** (SQLite) powered by **Drizzle ORM**, and full Discord Bot integration with Components V2.

---

## ⚡ Architecture & Highlights

- **Framework:** [Hono v4](https://hono.dev/) on Cloudflare Workers (sub-5ms cold starts globally).
- **Database:** Cloudflare D1 (SQLite) with [Drizzle ORM](https://orm.drizzle.team/).
- **Authentication:** Stateless HMAC-SHA256 JWT sessions exchangeable with AniList, MyAnimeList, and Simkl OAuth credentials.
- **Normalized Media Architecture:** Comments store only discussion data (`media_id`, `tag`, `tags`, etc.). Media metadata is normalized in a dedicated `media` table, auto-resolved via client APIs (AniList GraphQL, Jikan MAL, Simkl) upon first query or comment.
- **Cross-Platform Thread Merging (`media_id_map`):** Automatically links discussions across AniList, MAL, and Simkl IDs under deterministic keys (e.g. `anime:mal:21`), enabling cross-client unified discussions.
- **Tags & Content Warnings:** `tag` (integer) tracks specific episode or chapter numbers (e.g. `tag: 12`). `tags` (JSON string array) supports content warning labels such as `["spoiler"]`, `["nsfw"]`.
- **Full Discord Bot System:**
  - Public interaction endpoint (`/discord`) verifying Ed25519 signatures via `DISCORD_PUBLIC_KEY`.
  - 24 Slash Commands (`/help`, `/stats`, `/comment`, `/user`, `/queue`, `/recent`, `/register`, `/config`, etc.).
  - Auto-complete choices (Type 4) for media titles and users.
  - Modals (Type 5) for moderation reasons and durations.
  - Interactive Action Rows (Type 3) with Components V2 (`IS_COMPONENTS_V2 = 32768`) for moderation actions (`mod_delete`, `mod_warn`, `mod_mute`, `mod_ban`, `report_approve`, `report_dismiss`).
  - Guild server configuration via `/add` and auto-role assignment via `/register`.
- **Gamification & Social:** Daily streaks, point tracking with ad reward claims (AdMob atomic deduplication via `user_ad_rewards`), global leaderboards, cosmetics shop, and Discord avatar frames/banners.
- **Push Notifications:** Firebase Cloud Messaging (FCM) device registry and unread notification center.

---

## 📁 Repository Structure

```
commentum-v2/
├── docs/
│   ├── API_REFERENCE.md      # Comprehensive endpoint documentation
│   └── openapi.json          # OpenAPI 3.1.0 specification
├── drizzle/                  # D1 SQL migration files
├── src/
│   ├── db/
│   │   ├── index.ts          # Drizzle D1 database instance creator
│   │   └── schema.ts         # Complete D1 schema definition (23 tables)
│   ├── middleware/
│   │   └── auth.ts           # JWT session verification & role guards
│   ├── routes/
│   │   ├── announcements.ts  # System broadcast announcements
│   │   ├── auth.ts           # OAuth token exchange & session refresh
│   │   ├── comments.ts       # Comment CRUD (create, edit, delete)
│   │   ├── customizations.ts # Avatar frames, banners, closet catalog
│   │   ├── discord.ts        # Discord Gateway interactions & bot commands
│   │   ├── media.ts          # Media comments retrieval & thread merging
│   │   ├── moderation.ts     # Moderator staff actions & penalty controls
│   │   ├── notifications.ts  # In-app notifications & FCM device tokens
│   │   ├── points.ts         # Streaks, leaderboards & ad rewards
│   │   ├── reports.ts        # Content reporting & dispute resolution
│   │   ├── users.ts          # Profile customizations & multi-service linking
│   │   └── votes.ts          # Comment upvote/downvote toggles
│   ├── shared/
│   │   ├── clientAuth.ts     # AniList / MAL / Simkl token validation
│   │   ├── discord.ts        # Discord Bot API & Components V2 notifications
│   │   ├── jwt.ts            # Web Crypto HMAC-SHA256 JWT engine
│   │   ├── mediaMapping.ts   # Client API auto-resolution & ID mapping
│   │   ├── roles.ts          # Staff role hierarchies & permissions
│   │   └── translate.ts      # Multi-language translation utilities
│   ├── types/
│   │   └── env.ts            # Cloudflare Worker environment bindings
│   └── index.ts              # Hono application entry point
├── drizzle.config.ts         # Drizzle kit configuration
├── package.json
├── tsconfig.json
└── wrangler.toml             # Cloudflare Workers configuration
```

---

## 🛠️ Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (`v1.1+`)
- [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/)

### Installation

```bash
bun install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
JWT_SECRET=super-secret-hmac-sha256-key
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_PUBLIC_KEY=your_discord_application_public_key
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_APPLICATION_ID=your_discord_application_id
DISCORD_COMMAND_SYNC_ON_BOOT=false
ANILIST_CLIENT_ID=
ANILIST_CLIENT_SECRET=
SIMKL_CLIENT_ID=
```

### Database Migrations

Generate new migrations:
```bash
bun run db:generate
```

Apply migrations locally:
```bash
bunx wrangler d1 migrations apply commentum-v2 --local
```

### Development Server

```bash
bun run dev
```

The server starts locally at `http://localhost:8787`.

### Verification

```bash
bunx tsc --noEmit
```

---

## 📖 Documentation

- [API Reference](docs/API_REFERENCE.md)
- [OpenAPI 3.1.0 Specification](docs/openapi.json)
