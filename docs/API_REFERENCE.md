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

### 1.2. Get Current Session (`/auth/me`)
- **Method:** `GET /auth/me`
- **Headers:** `Authorization: Bearer <session_jwt>`

### 1.3. Refresh Session (`/auth/refresh`)
- **Method:** `POST /auth/refresh`
- **Headers:** `Authorization: Bearer <session_jwt>`

---

## 📺 2. Discussions & Media API

### 2.1. Fetch Comments for Media (`GET /media`)
- **Method:** `GET /media`
- **Auth:** Optional (if provided, personal `user_vote` status is populated)
- **Query Parameters:**
  * `media_id` (required): Media identifier (e.g., `"21"` for One Piece on MAL, `"21"` on AniList).
  * `client_type` (optional, default: `"anilist"`): `"anilist"`, `"mal"`, or `"simkl"`.
  * `tag` (optional): Episode or chapter number (e.g. `1115` for Episode 1115).
  * `sort` (optional, default: `"newest"`): `"newest"`, `"best"`, `"top"`, `"oldest"`.
  * `page` (optional, default: `1`): Pagination page.
  * `limit` (optional, default: `30`, max: `100`): Results per page.
  * `merge` (optional, default: `"true"`): When `"true"`, cross-platform comments from AniList, MAL, and Simkl are unified into a single thread.

---

## 💬 3. Comments CRUD & Anti-Spam

### 3.1. Create Comment
- **Method:** `POST /comments`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Anti-Spam & Limits Enforced:**
  * Rejects empty or invisible-only text (Unicode whitespace, Braille blank `\u2800`, zero-width format chars).
  * 5-second cooldown between comments for non-staff.
  * Burst limit: 5 comments / rolling minute.
  * Hourly limit: 20 comments / hour.
  * Duplicate detection: duplicate text within 10 minutes rejected with 429.
  * Mentions: automatic extraction of `@username` mentions creating notification alerts.
  * Points: automatically awards comment points and updates consecutive streaks.
- **Request Body:**
  ```json
  {
    "action": "create",
    "media_id": "21",
    "media_type": "anime",
    "content": "This episode was incredible! @Sheby you have to check this out.",
    "parent_id": null, // or comment_id for replies
    "tag": 1115 // optional episode or chapter number
  }
  ```

### 3.2. Edit Comment
- **Method:** `POST /comments`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Limits:** 30 edits / hour.
- **Request Body:**
  ```json
  {
    "action": "edit",
    "comment_id": 1234,
    "content": "Updated comment text"
  }
  ```

### 3.3. Delete Comment
- **Method:** `POST /comments`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Limits:** 30 deletes / hour.
- **Request Body:**
  ```json
  {
    "action": "delete",
    "comment_id": 1234
  }
  ```

### 3.4. Moderate Delete Comment (`mod_delete`)
- **Method:** `POST /comments`
- **Headers:** `Authorization: Bearer <session_jwt>` (Moderator+)
- **Request Body:**
  ```json
  {
    "action": "mod_delete",
    "comment_id": 1234,
    "reason": "Harassment and offensive language"
  }
  ```

### 3.5. On-Demand Translate Comment
- **Method:** `POST /comments`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Limits:** 15 translations / minute.
- **Request Body:**
  ```json
  {
    "action": "translate",
    "comment_id": 1234,
    "target_lang": "en"
  }
  ```

---

## 🗳️ 4. Voting System

### 4.1. Cast / Toggle Vote (`POST /votes`)
- **Method:** `POST /votes`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Limits:** 20 votes / minute.
- **Rules:**
  * Voting the same vote again removes it (toggle behavior).
  * Upvotes award points to the comment author.
  * Sends vote notification to the comment author if enabled.
- **Request Body:**
  ```json
  {
    "comment_id": 1234,
    "vote_type": 1 // 1 (upvote), -1 (downvote), 0 (remove)
  }
  ```

---

## 🚨 5. Reports & Moderation

### 5.1. File a Report (`POST /reports`)
- **Method:** `POST /reports`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Limits:** 3 reports / minute. Prevents duplicate reports by the same user. Dispatches Discord embed to staff.
- **Request Body:**
  ```json
  {
    "action": "report",
    "comment_id": 1234,
    "reason": "harassment",
    "notes": "User is attacking others"
  }
  ```

### 5.2. Moderation Queue (`POST /moderation`)
- **Method:** `POST /moderation`
- **Headers:** `Authorization: Bearer <session_jwt>` (Moderator+)
- **Request Body:**
  ```json
  {
    "action": "get_queue",
    "page": 1,
    "limit": 20,
    "status": "pending" // "pending" | "resolved" | "dismissed" | "all"
  }
  ```

### 5.3. Warn User (with Auto-Escalation)
- **Method:** `POST /moderation`
- **Headers:** `Authorization: Bearer <session_jwt>` (Moderator+)
- **Auto-Escalation:** 3 warnings auto-mutes for 24 hours; 5 warnings auto-bans the user.
- **Request Body:**
  ```json
  {
    "action": "warn_user",
    "target_user_id": "5724017",
    "client_type": "anilist",
    "reason": "Spamming discord links"
  }
  ```

### 5.4. Unwarn User
- **Method:** `POST /moderation`
- **Request Body:**
  ```json
  {
    "action": "unwarn_user",
    "target_user_id": "5724017",
    "client_type": "anilist"
  }
  ```

### 5.5. Mute / Unmute User
- **Method:** `POST /moderation`
- **Request Body:**
  ```json
  {
    "action": "mute_user", // or "unmute_user"
    "target_user_id": "5724017",
    "client_type": "anilist",
    "reason": "Repeated arguments",
    "muted_until": "2026-11-05T00:00:00Z"
  }
  ```

### 5.6. Ban / Unban User (Admin+)
- **Method:** `POST /moderation`
- **Request Body:**
  ```json
  {
    "action": "ban_user", // or "unban_user"
    "target_user_id": "5724017",
    "client_type": "anilist",
    "reason": "Severe rule violation"
  }
  ```

### 5.7. Shadowban User (Admin+)
- **Method:** `POST /moderation`
- **Request Body:**
  ```json
  {
    "action": "shadowban_user", // or "unshadowban_user"
    "target_user_id": "5724017",
    "client_type": "anilist",
    "reason": "Bot activity"
  }
  ```

---

## 🏆 6. Points, Streaks & Ad Rewards

Points unify across all linked accounts (AniList + MAL + Simkl).

### 6.1. Get Points Balance & Breakdown
- **Method:** `GET /points` or `POST /points`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "points": {
      "total_points": 1420,
      "real_points": 1420,
      "display_points": "1420",
      "is_infinite": false,
      "points_spent": 200,
      "tier": "veteran",
      "current_streak": 8,
      "longest_streak": 22,
      "leaderboard_rank": 4,
      "next_tier_at": 5000,
      "points_to_next_tier": 3580,
      "breakdown": {
        "from_comments": 850,
        "from_upvotes_received": 340,
        "from_downvotes_received": -10,
        "from_votes_cast": 80,
        "from_pinned": 30,
        "from_streak_bonus": 10,
        "from_role_bonus": 0,
        "from_ads": 120,
        "adjustments": 0,
        "points_spent": 200
      }
    }
  }
  ```

### 6.2. Claim Ad Points (AdMob)
- **Method:** `POST /points`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Limits:** 5 claims / min, 30 claims / hour.
- **Request Body:**
  ```json
  {
    "action": "claim_ad_points",
    "ad_id": "admob_reward_transaction_uuid",
    "points": 10
  }
  ```

### 6.3. Idempotent Point Spending
- **Method:** `POST /points`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Request Body:**
  ```json
  {
    "action": "spend_points_once",
    "ref_id": "store_purchase:item_123:user_5724017",
    "points": 200
  }
  ```

### 6.4. Global Leaderboard
- **Method:** `GET /points?action=get_leaderboard&limit=50`
- **Auth:** Public

---

## 🛍️ 7. Shop & Profile Customizations

### 7.1. Get Catalog (`GET /customizations`)
- **Method:** `GET /customizations`
- **Query Parameters:** `type` (`decoration`, `banner`, `nameplate`, `effect`), `category`.
- **Response:**
  ```json
  {
    "success": true,
    "decorations_enabled": true,
    "count": 1672,
    "items": [
      {
        "id": "decor_cyberpunk_neon",
        "type": "decoration",
        "title": "Cyberpunk Neon",
        "points_required": 500,
        "url": "https://cdn.discordapp.com/...",
        "metadata": { "bundle": "neon" }
      }
    ]
  }
  ```

### 7.2. Unlock Customization
- **Method:** `POST /users`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Request Body:**
  ```json
  {
    "action": "unlock_customization",
    "customization_id": "decor_cyberpunk_neon"
  }
  ```

### 7.3. Equip Customizations
- **Method:** `POST /users`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Request Body:**
  ```json
  {
    "action": "update_customizations",
    "avatar_decoration": "https://cdn.discordapp.com/...",
    "banner_url": "https://cdn.discordapp.com/...",
    "banner_theme": "dark_purple",
    "nameplate_theme": "gold",
    "profile_effect_url": "https://cdn.discordapp.com/..."
  }
  ```

---

## 🔗 8. Multi-Service Account Linking & Profiles

### 8.1. Public User Profile (`GET /users`)
- **Method:** `GET /users?user_id=5724017&client_type=anilist`

### 8.2. Search Users (`GET /users?action=search_users&q=sheby`)
- **Method:** `GET /users?action=search_users&q=sheby`

### 8.3. Batch User Customizations
- **Method:** `GET /users?action=get_batch_customizations&user_ids=1,2,3&client_type=anilist`

### 8.4. Link Account
- **Method:** `POST /users`
- **Headers:** `Authorization: Bearer <session_jwt>`
- **Request Body:**
  ```json
  {
    "action": "link_account",
    "target_client_type": "mal",
    "target_access_token": "mal_oauth_access_token"
  }
  ```

### 8.5. Unlink Account
- **Method:** `POST /users`
- **Request Body:**
  ```json
  {
    "action": "unlink_account",
    "service_to_unlink": "mal"
  }
  ```

### 8.6. Change Role (Staff Only)
- **Method:** `POST /users`
- **Headers:** `Authorization: Bearer <session_jwt>` (Admin+)
- **Cascades:** Changes role in `commentum_users` and all existing `comments.userRole`.
- **Request Body:**
  ```json
  {
    "action": "change_role",
    "target_user_id": "5724017",
    "client_type": "anilist",
    "role": "moderator"
  }
  ```

---

## 🔔 9. Notifications

### 9.1. Notification History (`GET /notifications`)
- **Method:** `GET /notifications`
- **Headers:** `Authorization: Bearer <session_jwt>`

### 9.2. Unread Count (`GET /notifications?action=get_unread_count`)
- **Method:** `GET /notifications?action=get_unread_count`

### 9.3. Mark as Read (`POST /notifications`)
- **Request Body:** `{ "action": "mark_read", "notification_id": 42 }` or `{ "action": "mark_all_read" }`

### 9.4. Register / Unregister FCM Token
- **Register:** `POST /notifications` with `{ "action": "register_token", "fcm_token": "...", "platform": "android" }`
- **Unregister:** `POST /notifications` with `{ "action": "unregister_token", "fcm_token": "..." }`

### 9.5. Notification Preferences
- **Get:** `GET /notifications?action=get_preferences`
- **Update:** `POST /notifications` with:
  ```json
  {
    "action": "update_preferences",
    "notify_on_reply": true,
    "notify_on_vote": true,
    "notify_on_mention": true,
    "notify_on_mod_action": true,
    "notify_on_announcement": true
  }
  ```

---

## 📢 10. Announcements

### 10.1. List Announcements
- **Method:** `GET /announcements?app_id=anymex`

### 10.2. Record View & Read Status
- **View:** `POST /announcements` with `{ "action": "view", "announcement_id": 5 }`
- **Read:** `POST /announcements` with `{ "action": "read", "announcement_id": 5 }`

### 10.3. Analytics (Staff)
- **Method:** `GET /announcements?action=analytics&id=5`

### 10.4. Publish Announcement (Staff)
- **Method:** `POST /announcements`
- **Headers:** `Authorization: Bearer <session_jwt>` (Admin+)
- **Request Body:**
  ```json
  {
    "title": "Version 2.0 Released!",
    "content": "Full markdown announcement content...",
    "category": "update",
    "priority": 1,
    "pinned": true
  }
  ```

### 10.5. Announcement Studio Web Dashboard & Staff Auth
- **Web Dashboard:** `GET /announcements/dashboard` or `GET /announcements/admin` (returns full interactive HTML UI)
- **Auth Status:** `GET /announcements/auth/status` (checks if initial master setup is needed)
- **Master Setup:** `POST /announcements/auth/setup` `{ "username": "Sheby", "password": "...", "linked_user_id": "5724017" }`
- **Login:** `POST /announcements/auth/login` `{ "username": "...", "password": "..." }` -> `{ "token": "...", "user": { ... } }`
- **Logout:** `POST /announcements/auth/logout` (revokes session token)
- **Current Staff Profile:** `GET /announcements/auth/me`
- **Change Password:** `POST /announcements/auth/change-password` `{ "current_password": "...", "new_password": "..." }`
- **Update Staff Profile:** `PATCH /announcements/auth/profile` `{ "display_name": "...", "avatar_url": "..." }`
- **Staff User List:** `GET /announcements/staff` (Super Admin or Owner)
- **Create Staff Member:** `POST /announcements/staff` `{ "username": "...", "password": "...", "role": "moderator" }`
- **Update Staff Member:** `PATCH /announcements/staff/:id`
- **Delete Staff Member:** `DELETE /announcements/staff/:id` (Owner only)
- **Unread Count:** `GET /announcements/unread-count?user_id=123&app_id=anymex`

---

## 🤖 11. Discord Bot Slash Commands

Commentum v2 supports 28 global slash commands:

* **Moderation:**
  * `/warn <user_id> <reason>`
  * `/unwarn <user_id>`
  * `/mute <user_id> [duration] [reason]`
  * `/unmute <user_id>`
  * `/ban <user_id> <reason> [shadow]`
  * `/unban <user_id>`
  * `/shadowban <user_id> <reason>`
  * `/unshadowban <user_id>`
  * `/pin <comment_id>`
  * `/unpin <comment_id>`
  * `/lock <comment_id>`
  * `/unlock <comment_id>`
  * `/delete <comment_id>`
  * `/queue`
  * `/search_comments [query] [user] [media]`
* **Points & Economy (Migration 052):**
  * `/points_give <user_id> <amount> <reason> [platform]`
  * `/points_deduct <user_id> <amount> <reason> [platform]`
  * `/points_check <user_id> [platform]`
  * `/points_undo <adjustment_id>`
* **Server Management & Info:**
  * `/stats`
  * `/user <user_id>`
  * `/comment <comment_id>`
  * `/config <action> [key] [value]`
  * `/add <server_name> <guild_id> [channel_id] [moderation_channel_id]`
  * `/promote <user_id> <role>`
  * `/demote <user_id> <role>`

---

## 🔄 12. Dantotsu 2-Way Sync Engine

* **Sync Status:** `GET /dantotsu-sync/status`
  * Returns total mapped comments (`dantotsu_id_mappings`) and cached media (`dantotsu_media_cache`).
* **Batch Resolve Unknown Media:** `POST /dantotsu-sync/resolve-media`
  * Resolves unknown media IDs by querying AniList GraphQL and caching metadata into `dantotsu_media_cache` and `media`.
* **Media Sync:** `POST /dantotsu-sync/sync-media`
  * Body: `{ "media_id": 21, "media_type": "anime" }`
  * Ingests external comments and replies from Dantotsu API (`https://api.dantotsu.app`) into Commentum.

---

## 💾 13. Database CSV Backup

* **Download Comments Database:** `GET /backup-table`
* **Headers:** `Authorization: Bearer <BACKUP_TOKEN | ADMIN_API_KEY>` or `x-admin-key: <ADMIN_API_KEY>`
* **Response:** RFC 4180 compliant CSV stream attachment (`anymex_global_db.csv`) containing all comment fields.
