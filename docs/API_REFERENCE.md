# Commentum v2 — Complete API Reference & Architecture

**Service Version:** `2.0.0`  
**Runtime:** Cloudflare Workers (V8 Isolates, Sub-5ms Cold Starts)  
**Database:** Cloudflare D1 (SQLite) with Drizzle ORM  
**Auth Scheme:** Stateless HMAC-SHA256 Session JWT  

---

## 🔐 1. Authentication & Session Lifecycle

Commentum v2 operates on the **"Authenticate Once, Authorize Everywhere"** principle. The client exchanges its third-party provider token once, receives a signed JWT, and attaches that token to all subsequent requests.

### 1.1. Login / Token Exchange
- **Method:** `POST /auth/login`
- **Auth:** None (Public)
- **Request Body:**
  ```json
  {
    "provider": "anilist", // "anilist" | "mal" | "simkl"
    "access_token": "provider_oauth_token_here"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "token_type": "Bearer",
    "expires_in": 604800,
    "expires_at": 1730376800,
    "user": {
      "id": 1,
      "user_id": "5724017",
      "username": "Sheby",
      "provider": "anilist",
      "role": "owner",
      "avatar": "https://s4.anilist.co/...",
      "total_points": 8200,
      "current_streak": 14,
      "longest_streak": 30,
      "avatar_decoration": "https://cdn.discordapp.com/...",
      "banner_url": null,
      "linked_accounts": {
        "anilist": { "id": "5724017", "username": "Sheby" },
        "mal": { "id": "1234567", "username": "ShebyMAL" },
        "simkl": null
      }
    }
  }
  ```

### 1.2. Get Current User Profile
- **Method:** `GET /auth/me`
- **Auth:** `Authorization: Bearer <session_token>`
- **Response:** Returns fresh user record with total points, streaks, equipped cosmetics, and linked accounts.

### 1.3. Refresh Session
- **Method:** `POST /auth/refresh`
- **Auth:** `Authorization: Bearer <session_token>`
- **Response:** Issues a renewed 7-day JWT.

---

## 📺 2. Discussions & Media API

### 2.1. Fetch Media Comments
- **Method:** `GET /media`
- **Auth:** Optional / Recommended
- **Query Parameters:**
  | Parameter | Type | Required | Description |
  |---|---|---|---|
  | `media_id` | string | **Yes** | AniList / MAL / Simkl media ID |
  | `client_type` | string | No | Source platform (`anilist`, `mal`, `simkl`) |
  | `media_type` | string | No | `anime` (default), `manga`, `novel` |
  | `tag` | integer | No | Specific episode or chapter number (e.g. `12`) |
  | `sort` | string | No | `newest` (default), `best`, `oldest` |
  | `page` | integer | No | Page number (default: 1) |
  | `limit` | integer | No | Items per page (default: 30, max: 100) |
  | `merge` | string | No | `true` (default: merges equivalent media threads) or `false` |
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "media_id": "21",
    "client_type": "anilist",
    "media": {
      "id": "21",
      "title": "One Piece",
      "type": "anime",
      "year": 1999,
      "poster": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/nx21-tXMK32w8nlMw.jpg"
    },
    "total_count": 25,
    "comments": [
      {
        "id": 104,
        "comment_id": 104,
        "content": "Incredible episode!",
        "username": "Sheby",
        "user_role": "owner",
        "avatar_decoration": "https://cdn.discordapp.com/...",
        "tag": 1100,
        "tags": ["spoiler"],
        "pinned": true,
        "vote_score": 142,
        "user_vote": 1,
        "replies_count": 3,
        "replies": [ ... ]
      }
    ]
  }
  ```

---

## 💬 3. Comments CRUD

### 3.1. Post a Comment or Reply
- **Method:** `POST /comments`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body (Create):**
  ```json
  {
    "action": "create",
    "media_id": "21",
    "media_type": "anime",
    "content": "This arc is peak fiction!",
    "tag": 1100,
    "tags": ["spoiler"],
    "parent_id": null
  }
  ```

### 3.2. Edit a Comment
- **Method:** `POST /comments`
- **Auth:** `Authorization: Bearer <session_token>` (Author or Staff)
- **Request Body (Edit):**
  ```json
  {
    "action": "edit",
    "comment_id": 104,
    "content": "Updated content..."
  }
  ```

### 3.3. Delete a Comment
- **Method:** `POST /comments`
- **Auth:** `Authorization: Bearer <session_token>` (Author or Staff)
- **Request Body (Delete):**
  ```json
  {
    "action": "delete",
    "comment_id": 104
  }
  ```

---

## 🗳️ 4. Voting System

- **Method:** `POST /votes`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "comment_id": 104,
    "vote_type": 1 // 1 for upvote, -1 for downvote, 0 to remove
  }
  ```
- **Behavior:** Toggles automatically if clicked again. Returns updated `vote_score`, `upvotes`, and `downvotes`.

---

## 🚨 5. Reports & Moderation

### 5.1. File a Report
- **Method:** `POST /reports`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "report",
    "comment_id": 104,
    "reason": "spoiler",
    "notes": "Untagged ending spoilers"
  }
  ```

### 5.2. Staff Moderation Actions
- **Method:** `POST /moderation`
- **Auth:** `Authorization: Bearer <session_token>` (Requires `moderator` or `admin` role)
- **Supported Actions:**
  * `pin_comment` / `unpin_comment`: Pin discussion to top.
  * `lock_thread` / `unlock_thread`: Prevent new replies.
  * `warn_user`: Issues structured warning stored on user profile.
  * `mute_user` / `unmute_user`: Temporarily mutes user from commenting.
  * `ban_user` / `unban_user`: Permanently or temporarily bans user account.

---

## 🏆 6. Points, Streaks & Ad Rewards

### 6.1. Get Points Balance
- **Method:** `GET /points` or `POST /points` (`{ "action": "get_points" }`)
- **Auth:** `Authorization: Bearer <session_token>`

### 6.2. Global Leaderboard
- **Method:** `GET /points?action=get_leaderboard&limit=50`
- **Auth:** None (Public)
- **Response:** Ranked users by total points with avatar decorations and streaks.

### 6.3. Claim Ad Points (AdMob)
- **Method:** `POST /points`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "claim_ad_points",
    "ad_id": "admob_reward_transaction_abc123",
    "points": 10
  }
  ```
- **Guarantees:** Atomic deduplication via `user_ad_rewards` table.

---

## 🛍️ 7. Shop & Profile Customizations

### 7.1. Shop Catalog
- **Method:** `GET /customizations`
- **Auth:** None (Public)
- **Query Params:** `type=decoration|banner|nameplate|effect`

### 7.2. Unlock Item with Points
- **Method:** `POST /users`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "unlock_customization",
    "customization_id": "discord_neon_cyber_frame"
  }
  ```

### 7.3. Equip Profile Cosmetics
- **Method:** `POST /users`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "update_customizations",
    "avatar_decoration": "https://cdn.discordapp.com/...",
    "banner_url": "https://...",
    "nameplate_theme": "neon",
    "profile_effect_url": "https://..."
  }
  ```

---

## 🔗 8. Multi-Service Account Linking

### 8.1. Link Secondary Account
- **Method:** `POST /users`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "link_account",
    "target_client_type": "mal",
    "target_access_token": "mal_oauth_access_token_here"
  }
  ```

### 8.2. Unlink Secondary Account
- **Method:** `POST /users`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "unlink_account",
    "service_to_unlink": "mal"
  }
  ```

---

## 🔔 9. Notifications & FCM

### 9.1. Register FCM Token
- **Method:** `POST /notifications`
- **Auth:** `Authorization: Bearer <session_token>`
- **Request Body:**
  ```json
  {
    "action": "register_token",
    "fcm_token": "fcm_device_token_string",
    "platform": "android",
    "app_version": "3.5.0"
  }
  ```

### 9.2. Notification History & Unread Count
- `GET /notifications?action=get_history&page=1&limit=30`
- `GET /notifications?action=get_unread_count`
- `POST /notifications` with `{ "action": "mark_read", "notification_id": 451 }`
- `POST /notifications` with `{ "action": "mark_all_read" }`

---

## 📢 10. Announcements

- `GET /announcements?app_id=anymex`: Public feed of broadcasts with read status.
- `POST /announcements`: Admin creation and publishing of announcements.

---

## 🤖 11. Discord Bot System & Gateway Interactions

Commentum v2 features a standalone Discord Bot integration targeting configured channels in `server_configs` via Discord Bot API and Components V2.

### 11.1. Gateway Interactions Endpoint
- **Method:** `POST /discord`
- **Security:** Ed25519 signature verified via `X-Signature-Ed25519` and `X-Signature-Timestamp` against `DISCORD_PUBLIC_KEY`.
- **Supported Interactions:**
  - `Type 1 (PING)`: Automatic `PONG` response.
  - `Type 2 (APPLICATION_COMMAND)`: Handles all 24 slash commands:
    * `/help`: Detailed command list and permission requirements.
    * `/stats`: Live system analytics, user counts, and active discussions.
    * `/comment <id>`: Fetches full comment thread and enriched media info.
    * `/user <username|id>`: Displays user points, warnings, roles, and status.
    * `/search_comments <query>`: Text search across all comments.
    * `/queue`: Staff pending moderation review queue.
    * `/recent`: Recent comments across media titles.
    * `/register`: Registers user's Discord account and auto-assigns server role.
    * `/add`: Admin command to configure guild channels (`channel_id`, `updates_channel_id`, `moderation_channel_id`, `role_id`).
    * `/warn`, `/mute`, `/unmute`, `/ban`, `/unban`: Staff moderation commands.
    * `/config`: Displays or updates system toggles and auto thresholds.
    * `/broadcast`: Sends rich announcement to configured Discord channels.
  - `Type 3 (MESSAGE_COMPONENT)`: Interactive Discord Components V2 action buttons:
    * `mod_delete:<id>:<user_id>`: Deletes comment and logs action.
    * `mod_warn:<user_id>`: Issues warning modal or immediate warning.
    * `mod_mute:<user_id>`: Opens mute duration modal.
    * `mod_ban:<user_id>`: Bans user account.
    * `report_approve:<id>`: Resolves report and removes flagged content.
    * `report_dismiss:<id>`: Dismisses report and restores normal status.
  - `Type 4 (APPLICATION_COMMAND_AUTOCOMPLETE)`: Dynamic media titles and usernames autocomplete.
  - `Type 5 (MODAL_SUBMIT)`: Handles submitted reason, duration, and notes forms.

### 11.2. Components V2 Notifications
Dispatched asynchronously on comment events (`comment_created`, `comment_deleted`, `report_filed`, etc.) with message flag `32768` (`IS_COMPONENTS_V2`), container accents, deep link buttons, and moderation buttons.
