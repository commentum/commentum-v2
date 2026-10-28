# Commentum v2 — Complete Architecture & API Revamp Specification

**Target Branch:** `revamp`  
**Scope:** 100% Coverage of All Commentum v2 TypeScript Edge Functions, Services & Integrations  
**Status:** Approved for Implementation  
**Date:** October 2026  

---

## 1. Executive Summary & Codebase Audit

Commentum v2 is an enterprise-grade backend service powering comments, community interactions, profile customizations, and gamification across **AnymeX** and the anime/manga/novel client ecosystem, with integrations for **Discord** and **Firebase Cloud Messaging (FCM)**.

An audit of all 28+ TypeScript files in `supabase/functions/` identified the following critical areas for optimization and security hardening:

1. **Identity Spoofing Vulnerability:** In `comments/index.ts`, `votes/index.ts`, `reports/index.ts`, and `points/index.ts`, endpoints currently accept an unverified `user_info` JSON object (`{ user_id, username, avatar }`) in request bodies. Any client can spoof user IDs to post comments, cast votes, file reports, or manipulate reputation.
2. **Third-Party API Latency & Rate Limits:** In `users/index.ts`, `moderation/index.ts`, and `announcements/index.ts`, the backend verifies OAuth tokens against external provider APIs (`graphql.anilist.co`, `api.myanimelist.net`, `api.simkl.com`) on **every single request**. This introduces 300ms–1500ms latency per action and risks hitting upstream provider rate limits.
3. **Payload Bloat:** Clients repeatedly transmit redundant user metadata (avatars, usernames, roles, decoration links) in request bodies on every comment submission.
4. **Action Dispatcher Fragmentation:** Multiple endpoints rely on bulky `action` switch statements inside single `POST` endpoints instead of clean RESTful HTTP verbs.

### The Revamp Core Rule: "Authenticate Once, Authorize Everywhere"
- **One-Time Client Token Exchange (`POST /auth/login`):** The client provides its provider OAuth token (`access_token`) for AniList, MyAnimeList, or Simkl. The backend verifies the token once with the provider, upserts the user profile in `commentum_users`, and mints a cryptographically signed **Commentum Session JWT**.
- **Stateless Request Authorization:** Every subsequent call carries `Authorization: Bearer <commentum_token>`. The backend verifies the JWT in `<1ms` without calling external APIs or reading the database repeatedly.
- **Verified Identity Everywhere:** The backend strictly extracts user identity (`user_id`, `provider`, `role`, `customizations`) from the verified token. Unverified `user_info` in request bodies is completely eliminated.

---

## 2. Complete System Architecture & Module Map

Commentum v2 comprises **11 distinct functional subsystems**:

```mermaid
graph TD
    Client[Client Apps: AnymeX, Desk, ShonenX] -->|1. Provider OAuth Token| AuthModule[/auth: One-Time Token Exchange]
    AuthModule -->|Verify with Provider| Providers[(AniList, MAL, Simkl APIs)]
    AuthModule -->|Upsert User & Role| UserDB[(commentum_users Table)]
    AuthModule -->|Return Signed JWT| Client

    Client -->|2. Bearer JWT + Clean Payload| API_Gateway[Edge Function Gateway]

    API_Gateway --> CommentsModule[/comments & /media: Comments Engine]
    API_Gateway --> VotesModule[/votes: Voting System]
    API_Gateway --> ReportsModule[/reports: Moderation Queue]
    API_Gateway --> ModModule[/moderation: Staff Actions]
    API_Gateway --> UsersModule[/users: Profile, Link & Inventory]
    API_Gateway --> PointsModule[/points: Streaks & Leaderboard]
    API_Gateway --> CustomModule[/customizations: Discord Collectibles Shop]
    API_Gateway --> NotifsModule[/notifications: FCM & Preferences]
    API_Gateway --> AnnounceModule[/announcements: Multi-App Broadcast & Admin Dashboard]
    
    CommentsModule --> DiscordBridge[/discord: 3-Channel Bot & Embeds]
    CommentsModule --> FCMBridge[shared/fcmNotifications: Push Service]
```

---

## 3. Subsystem 1: Authentication & Identity (`/auth`)

Replaces ad-hoc token verification with a centralized, secure token lifecycle.

### 3.1. Multi-Provider Token Verification
Supports all three core media providers with normalized outputs:
- **AniList**: POST to `https://graphql.anilist.co` with `query { Viewer { id name avatar { large } bannerImage } }`.
- **MyAnimeList**: GET to `https://api.myanimelist.net/v2/users/@me?fields=picture`.
- **Simkl**: GET to `https://api.simkl.com/users/settings` with `Authorization: Bearer <token>` and `simkl-api-key`.

### 3.2. Endpoints

#### `POST /auth/login`
- **Purpose**: Exchange provider OAuth token for Commentum session.
- **Request Body**:
  ```json
  {
    "provider": "anilist", // "anilist" | "mal" | "simkl"
    "access_token": "oauth_access_token_string"
  }
  ```
- **Backend Flow**:
  1. Call provider API to verify token and extract `provider_user_id`, `username`, `avatar_url`.
  2. Normalize user ID to unified format: `commentum_user_id` = `${provider}:${provider_user_id}` (e.g., `anilist:12345`).
  3. Upsert into `commentum_users`: updates username, avatar, last active timestamp.
  4. Fetch user's resolved role (hierarchy: `owner` > `app_owner` > `super_admin` > `admin` > `moderator` > `user`), ban/mute status, points balance, and active customizations.
  5. Sign JWT with HMAC-SHA256 (`JWT_SECRET`) containing claims:
     ```json
     {
       "sub": "anilist:12345",
       "uid": "12345",
       "provider": "anilist",
       "username": "Sheby",
       "role": "owner",
       "iat": 1729158000,
       "exp": 1729762800 // 7 days
     }
     ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "expires_at": 1729762800,
    "user": {
      "user_id": "12345",
      "commentum_user_id": "anilist:12345",
      "provider": "anilist",
      "username": "Sheby",
      "avatar_url": "https://s4.anilist.co/...",
      "role": "owner",
      "display_role": "owner",
      "is_banned": false,
      "is_muted": false,
      "total_points": 8200,
      "current_streak": 14,
      "longest_streak": 30,
      "customizations": {
        "avatar_decoration": "https://cdn.discordapp.com/avatar-decoration-presets/a_123.png",
        "nameplate_theme": "neon",
        "banner_url": "https://...",
        "profile_effect_url": "https://..."
      },
      "linked_accounts": [
        { "provider": "mal", "user_id": "67890", "username": "ShebyMAL" }
      ]
    }
  }
  ```

#### `GET /auth/me`
- **Auth**: `Authorization: Bearer <token>`
- **Response**: Fresh user profile, streak check, active penalties, and point balance.

#### `POST /auth/refresh`
- **Auth**: `Authorization: Bearer <token>`
- **Response**: Refreshed JWT token with updated 7-day expiration.

---

## 4. Subsystem 2: Comments & Threading Engine (`/comments`, `comments/index.ts`)

### 4.1. Key Changes & Omissions
- **Omit `user_info`:** The author is extracted strictly from the JWT token.
- **Omit `client_type` & `access_token` in body:** Client type and user verification are handled via the JWT.
- **Omit manual timestamps:** Managed by database defaults (`NOW()`).
- **RESTful Endpoints:** Standardize method dispatching (`GET`, `POST`, `PATCH`, `DELETE`).

### 4.2. Endpoints

#### `POST /comments` (Create Comment / Reply)
- **Auth**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "media_id": "16498",
    "media_type": "anime",           // "anime" | "manga" | "novel"
    "media_title": "Attack on Titan",
    "content": "Incredible plot twist @JohnDoe!",
    "tag": 12,                       // Episode or chapter tag (nullable)
    "parent_id": null,               // Null for top-level, comment_id for reply
    "target_language": "en"          // Optional auto-translate target
  }
  ```
- **Backend Flow**:
  1. Extract user from JWT. Check if muted or banned; reject immediately if restricted.
  2. Sanitize content and parse mentions (`@username`) via `mentionUtils.ts`.
  3. Insert into `comments` table with author's verified data, role, and active customizations.
  4. Trigger background async tasks:
     - Push FCM notifications to mentioned users and parent comment author.
     - Dispatch Discord notification to `#comments` channel with interactive action buttons.
     - Increment user daily activity and update streaks via `points` RPC.
- **Response (201 Created)**: Created comment object with author details and initialized counters (`upvotes: 0`, `downvotes: 0`, `vote_score: 0`).

#### `PATCH /comments/:id` (Edit Comment)
- **Auth**: `Authorization: Bearer <token>`
- **Request Body**: `{ "content": "Updated content..." }`
- **Rules**: Only the original author can edit.

#### `DELETE /comments/:id` (Delete Comment)
- **Auth**: `Authorization: Bearer <token>`
- **Rules**: Allowed if requester is the original author OR requester has role `>= moderator`.
- **Backend Flow**: Soft deletes comment (`deleted = true`), clears content text, and cleans up notifications.

#### `POST /comments/:id/translate`
- **Auth**: Optional / Public
- **Request Body**: `{ "target_language": "es" }`
- **Response**: Cached or newly translated comment text using `shared/translate.ts`.

---

## 5. Subsystem 3: Media Comment Threads & Cross-Client Resolver (`/media`, `media/index.ts`)

Retrieves threaded discussions for anime, manga, and light novels.

### 5.1. Features
- **Cross-Client Media Mapping (`media_id_map`)**: Unifies comment threads across providers. Comments posted on AniList ID `21` (One Piece), MAL ID `21`, and Simkl ID `38636` are merged into a single cohesive thread.
- **User Vote Injection**: If a valid `Bearer <token>` is passed in headers, the API decorates each comment with `user_vote: 1 | -1 | 0` so the client UI knows the user's vote state immediately.

### 5.2. Endpoint: `GET /media`
- **Query Parameters**:
  - `media_id`: (Required) Media ID.
  - `client_type`: (Required) `anilist` | `mal` | `simkl`.
  - `media_type`: Optional `anime` | `manga` | `novel`.
  - `tag`: Optional filter by episode/chapter number.
  - `sort`: `newest` | `oldest` | `top` | `controversial`.
  - `page`: Page index (default: `1`).
  - `limit`: Page size (default: `50`, max: `100`).
  - `merge`: Cross-client merge toggle (default: `true`).
- **Response (200 OK)**:
  ```json
  {
    "media": {
      "media_id": "16498",
      "media_type": "anime",
      "media_title": "Attack on Titan"
    },
    "comments": [
      {
        "id": 1420,
        "content": "Peak fiction!",
        "tag": 12,
        "labels": ["Theory"],
        "parent_id": null,
        "created_at": "2026-10-17T12:00:00Z",
        "upvotes": 42,
        "downvotes": 1,
        "vote_score": 41,
        "user_vote": 1,
        "is_pinned": true,
        "is_locked": false,
        "reply_count": 5,
        "author": {
          "user_id": "12345",
          "username": "Sheby",
          "avatar_url": "https://...",
          "role": "owner",
          "bonus_tag": { "text": "∞", "color": "#FFD700", "label": "Owner" },
          "badges": ["early_supporter", "contributor"],
          "customizations": {
            "avatar_decoration": "https://cdn.discordapp.com/avatar-decoration-presets/a_123.png",
            "nameplate_theme": "neon",
            "banner_url": "https://..."
          }
        },
        "replies": []
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 145,
      "total_pages": 3,
      "has_more": true
    }
  }
  ```

---

## 6. Subsystem 4: Voting Engine (`/votes`, `votes/index.ts`)

Replaces the unauthenticated voter ID system with verified token authorization.

### 6.1. Endpoint: `POST /votes`
- **Auth**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "comment_id": 1420,
    "vote_type": "upvote" // "upvote" | "downvote" | "remove"
  }
  ```
- **Backend Flow**:
  1. Extract verified `user_id` from token.
  2. Atomically calculate vote delta in database.
  3. Update `comments.upvotes`, `comments.downvotes`, and user vote tracking.
  4. Award/deduct activity points to the comment author via `points` RPC.
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "comment_id": 1420,
    "vote_score": 42,
    "upvotes": 43,
    "downvotes": 1,
    "user_vote": "upvote"
  }
  ```

---

## 7. Subsystem 5: Reports & Moderation Engine (`/reports`, `/moderation`)

### 7.1. Reports Endpoint: `POST /reports`
- **Auth**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "action": "create",
    "comment_id": 1420,
    "reason": "spoiler", // "spam" | "offensive" | "harassment" | "spoiler" | "nsfw" | "off_topic" | "other"
    "notes": "Unmarked manga spoiler for chapter 139"
  }
  ```
- **Action**: Registers report with verified reporter ID, checks report thresholds for auto-hiding, and pushes notification to Discord `#reports` channel.

### 7.2. Moderation Endpoints: `/moderation`
- **Auth**: `Authorization: Bearer <token>` (Min Role: `moderator`)
- **Actions Supported**:
  - `pin_comment` / `unpin_comment` (`comment_id`, `reason`)
  - `lock_thread` / `unlock_thread` (`comment_id`, `reason`)
  - `warn_user` (`target_user_id`, `reason`, `severity`, `duration`)
  - `unwarn_user` (`target_user_id`, `warning_id`)
  - `mute_user` (`target_user_id`, `duration_hours`, `reason`)
  - `unmute_user` (`target_user_id`)
  - `ban_user` (`target_user_id`, `reason`, `shadow_ban: boolean`, `delete_all_comments: boolean`) — Min Role: `admin`
  - `unban_user` (`target_user_id`, `reason`) — Min Role: `admin`
  - `get_queue` — Lists pending reports, flagged comments, and user warning counts.
- **Discord Mod Log**: All moderation actions are automatically logged to the Discord `#mod-logs` channel with the moderator's verified username and reason.

---

## 8. Subsystem 6: User Management, Profiles & Linking (`/users`, `users/index.ts`)

Replaces repetitive external token verification with verified token authorization.

### 8.1. Endpoints & Actions
- **`GET /users/:id/profile`**:
  - Returns complete public profile: badges, comment history count, unlocked decorations, points, leaderboard rank, and streak stats.
- **`PATCH /users/me/customizations`**:
  - Equips/unequips unlocked cosmetics.
  - Body:
    ```json
    {
      "avatar_decoration": "a_47202ff223e839a2ecf14a8b0f3ce7a1.png",
      "nameplate_theme": "neon",
      "banner_url": "https://...",
      "profile_effect_url": "https://..."
    }
    ```
- **`POST /users/me/unlock-customization`**:
  - Unlocks a shop item from `customizations_catalog` using earned points.
  - Body: `{ "customization_id": "a_47202ff223e839a2ecf14a8b0f3ce7a1.png" }`
  - Checks point balance; deducts points or bypasses for staff (`owner`, `super_admin`).
- **`POST /users/me/link-account`**:
  - Links an additional provider account (e.g. AniList user linking their MAL or Simkl account).
  - Body: `{ "target_provider": "mal", "target_access_token": "..." }`
  - Verifies target token and stores cross-link in `commentum_users`.
- **`POST /users/me/unlink-account`**:
  - Body: `{ "target_provider": "mal" }`
- **`POST /users/admin/change-role`** (Owner / SuperAdmin only):
  - Assigns role (`moderator`, `admin`, `super_admin`) to target user in DB.

---

## 9. Subsystem 7: Gamification, Points & Streaks (`/points`, `points/index.ts`)

### 9.1. Points System Rules
- **Activity Earnings**:
  - New Comment: `+15` points (max 10/day).
  - Reply to Comment: `+10` points.
  - Received Upvote: `+5` points.
  - Daily Login / First Action Streak: `+20` points base + streak multiplier.
  - Watching Voluntary Rewarded Ads: Custom points (default `+10`) with cross-account deduplication.
- **Penalties**:
  - Warning: `-100` points.
  - Comment Deleted by Mod: `-50` points.
  - Mute / Ban: Streak reset & ranking freeze.
- **Staff Bonuses**:
  - `owner` / `app_owner`: `∞` (infinite balance tag).
  - `super_admin`: `+500` bonus tag.
  - `admin`: `+300` bonus tag.
  - `moderator`: `+150` bonus tag.

### 9.2. Endpoints
- **`GET /points/me`**: Returns requester's points, rank, streak, and complete earnings breakdown.
- **`GET /points/user/:id`**: Returns target user's public points (negative penalties hidden from non-mods).
- **`GET /points/leaderboard`**:
  - Query: `page=1&limit=50&client_type=all`.
  - Returns top ranked users with points, streak, badges, avatar decorations, and rank badges.
- **`POST /points` (`claim_ad_points`)**: Claim points for watching a voluntary ad (`ad_id`, `points`). Authenticated via session Bearer token and deduplicated across all linked accounts.
- **`POST /points/batch`**: Efficiently resolves points and badges for multiple user IDs in one SQL query.

---

## 10. Subsystem 8: Customizations Catalog & Shop (`/customizations`, `customizations/index.ts`)

Serves the 1,672+ collectibles library.

### 10.1. Item Types Supported
1. **Avatar Decorations (`type=decoration`)**: 457 Discord collectible animated APNGs / PNGs.
2. **Nameplates (`type=nameplate`)**: 246 animated WebM nameplates with static PNG fallbacks and color palettes.
3. **Profile Effects (`type=effect`)**: 270 full-screen and profile modal animations.
4. **Category Banners (`type=banner`)**: Curated anime and art banners grouped by category.
5. **Theme Bundles**: Multi-item coordinated sets.

### 10.2. Endpoint: `GET /customizations`
- **Access**: Public, edge-cached (`Cache-Control: public, max-age=3600`).
- **Query Parameters**:
  - `type`: `all` | `decoration` | `nameplate` | `banner` | `effect`.
  - `category`: Filter by collection theme (e.g., `Fall Foragers`, `Gooooal!`).
  - `search`: Keyword search across titles and descriptions.
  - `categorized`: (Banners) Returns grouped dictionary by category.
  - `limit`: Default `50`, max `2000`.
  - `offset`: Pagination offset.

---

## 11. Subsystem 9: Notifications & Push Service (`/notifications`, `shared/fcmNotifications.ts`)

Provides real-time notifications for user interactions even when the app is closed.

### 11.1. Notification Triggers (21 Event Types)
- Comments: `comment_reply`, `user_mentioned`, `comment_pinned`, `comment_locked`.
- Votes: `vote_cast` (aggregated to prevent spam).
- Reports & Staff: `report_resolved`, `user_warned`, `user_muted`, `user_banned`.
- Announcements: `announcement_published`.

### 11.2. Endpoints
- **`POST /notifications/fcm/register`**:
  - Body: `{ "fcm_token": "...", "device_info": "Pixel 8", "platform": "android" }`
  - Upserts active push token for authenticated user.
- **`POST /notifications/fcm/unregister`**: Deactivates token.
- **`GET /notifications`**: Returns user's in-app notification history with pagination.
- **`PATCH /notifications/:id/read`**: Marks notification as read.
- **`POST /notifications/read-all`**: Marks all notifications as read.
- **`GET /notifications/unread-count`**: Returns badge count for client navbar.
- **`GET /notifications/preferences`** & **`PATCH /notifications/preferences`**:
  - Controls fine-grained user toggles:
    - `notify_replies: boolean`
    - `notify_mentions: boolean`
    - `notify_votes: boolean`
    - `notify_announcements: boolean`
    - `notify_moderation: boolean`

---

## 12. Subsystem 10: Announcements & Web Dashboard (`/announcements`, `announcements/index.ts`)

Provides multi-app announcements and staff dashboard management.

### 12.1. Endpoints
- **`GET /announcements`**:
  - Query: `app_id=anymex&category=feature&page=1&limit=20`.
  - Public listing of published announcements.
- **`GET /announcements/:id`**: Full markdown announcement with view counter increment.
- **`GET /announcements/unread-count`**: User unread announcements count.
- **`POST /announcements/:id/read`**: Mark announcement as read for user.
- **Staff Operations** (Role: `super_admin`+ or Dashboard Session):
  - `POST /announcements` (Create draft / publish)
  - `PATCH /announcements/:id` (Edit title, priority, markdown content)
  - `DELETE /announcements/:id` (Delete)
  - `POST /announcements/:id/publish` (Broadcasts to Discord announcements channel and pushes FCM alerts)
- **Web Dashboard (`/announcements/dashboard`)**:
  - Embedded HTML dashboard with session authentication (`/auth/login`, `/auth/logout`, `/staff`).

---

## 13. Subsystem 11: Discord Bot & 3-Channel Integration (`/discord`, `shared/discordNotifications.ts`)

Interacts with Discord guilds using ed25519-signed interactions.

### 13.1. The 3-Channel Architecture
1. **`#comments` Channel**:
   - Rich embed for every new comment.
   - Interactive Components V2 buttons:
     - 🗑️ `Delete Comment` (prompts confirmation, checks mod role)
     - ⚠️ `Warn User` (opens modal for warning text)
     - 🔨 `Ban User`
2. **`#reports` Channel**:
   - Embed with reporter, reason, comment content, and violation history.
   - Buttons: `Resolve & Delete`, `Dismiss Report`.
3. **`#mod-logs` Channel**:
   - Audit trail of all actions executed via Discord or the in-app API.

---

## 14. Complete API Reference Matrix (Post-Revamp)

| HTTP Method | Route | Authentication | Payload Type | Description |
| :--- | :--- | :--- | :--- | :--- |
| **AUTH** | | | | |
| `POST` | `/auth/login` | None (OAuth Token) | JSON `{ provider, access_token }` | Exchange client token for Commentum JWT |
| `GET` | `/auth/me` | Bearer Token | None | Get authenticated user profile & roles |
| `POST` | `/auth/refresh` | Bearer Token | None | Refresh 7-day JWT session |
| **COMMENTS** | | | | |
| `GET` | `/media` | Bearer Token | Query Params | Fetch media comments (requires login, includes `user_vote`) |
| `POST` | `/comments` | Bearer Token | JSON `{ media_id, content, tag, parent_id }` | Post top-level comment or reply |
| `PATCH` | `/comments/:id` | Bearer Token | JSON `{ content }` | Edit own comment |
| `DELETE` | `/comments/:id` | Bearer Token | None | Delete comment (own or mod) |
| `POST` | `/comments/:id/translate` | Optional | JSON `{ target_language }` | Translate comment text |
| **VOTES** | | | | |
| `POST` | `/votes` | Bearer Token | JSON `{ comment_id, vote_type }` | Upvote, downvote, or clear vote |
| **REPORTS & MOD**| | | | |
| `POST` | `/reports` | Bearer Token | JSON `{ comment_id, reason, notes }` | Report a comment |
| `POST` | `/moderation` | Bearer Token (Mod+) | JSON `{ action, ...params }` | Pin, lock, warn, mute, ban, view queue |
| **USERS** | | | | |
| `GET` | `/users/:id/profile` | Optional | None | View user public profile & badges |
| `PATCH` | `/users/me/customizations` | Bearer Token | JSON `{ avatar_decoration, nameplate, banner }`| Equip profile cosmetics |
| `POST` | `/users/me/unlock-customization`| Bearer Token | JSON `{ customization_id }` | Purchase cosmetic using points |
| `POST` | `/users/me/link-account` | Bearer Token | JSON `{ target_provider, target_access_token }` | Link second provider |
| `POST` | `/users/me/unlink-account` | Bearer Token | JSON `{ target_provider }` | Unlink provider |
| **POINTS** | | | | |
| `GET` | `/points/me` | Bearer Token | None | Get points balance, rank & breakdown |
| `GET` | `/points/leaderboard` | Public | Query Params | Global community rankings |
| `POST` | `/points/batch` | Public | JSON `{ user_ids }` | Batch fetch points for comments list |
| **CUSTOMIZATIONS**| | | | |
| `GET` | `/customizations` | Public (Cached) | Query Params | Full 1,672 item shop catalog |
| **NOTIFICATIONS** | | | | |
| `POST` | `/notifications/fcm/register`| Bearer Token | JSON `{ fcm_token, device_info, platform }` | Register push token |
| `POST` | `/notifications/fcm/unregister`| Bearer Token| JSON `{ fcm_token }` | Unregister push token |
| `GET` | `/notifications` | Bearer Token | Query Params | User notification history |
| `PATCH` | `/notifications/:id/read` | Bearer Token | None | Mark single notification read |
| `POST` | `/notifications/read-all` | Bearer Token | None | Mark all notifications read |
| `GET` | `/notifications/unread-count`| Bearer Token| None | Badge count |
| `GET` / `PATCH`| `/notifications/preferences` | Bearer Token | JSON `{ notify_replies, ... }` | Notification settings |
| **ANNOUNCEMENTS** | | | | |
| `GET` | `/announcements` | Public | Query Params | List public announcements |
| `GET` | `/announcements/:id` | Public | None | Read single announcement |
| `POST` | `/announcements/:id/read` | Bearer Token | None | Mark announcement read |
| `POST` | `/announcements` | Bearer Token (Admin)| JSON `{ title, content, app_id, ... }` | Create announcement |
| `PATCH` | `/announcements/:id` | Bearer Token (Admin)| JSON `{ title, content, ... }` | Update announcement |
| `DELETE` | `/announcements/:id` | Bearer Token (Admin)| None | Delete announcement |

---

## 15. Client Implementation Blueprint (`CommentumService.dart` in AnymeX)

### 15.1. Authentication Architecture
The client manages the session token transparently:

```dart
class CommentumAuthSession {
  final String token;
  final DateTime expiresAt;
  final CommentumUser user;

  CommentumAuthSession({
    required this.token,
    required this.expiresAt,
    required this.user,
  });

  bool get isExpired => DateTime.now().isAfter(expiresAt.subtract(const Duration(hours: 6)));
}

class CommentumService extends GetxController {
  CommentumAuthSession? _session;

  // Cached header helper
  Map<String, String> get authHeaders => {
    'Content-Type': 'application/json',
    if (_session?.token != null) 'Authorization': 'Bearer ${_session!.token}',
  };

  Future<void> ensureAuthenticated() async {
    // 1. Check if valid session exists in memory or local storage
    if (_session != null && !_session!.isExpired) return;

    // 2. Retrieve provider OAuth token (AniList / MAL / Simkl)
    final provider = currentServiceType.name; // 'anilist', 'mal', 'simkl'
    final clientToken = await getProviderOAuthToken();
    if (clientToken == null) return;

    // 3. One-time exchange with Commentum v2
    final response = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'provider': provider,
        'access_token': clientToken,
      }),
    );

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      _session = CommentumAuthSession(
        token: data['token'],
        expiresAt: DateTime.fromMillisecondsSinceEpoch(data['expires_at'] * 1000),
        user: CommentumUser.fromJson(data['user']),
      );
      // Persist to KvHelper
      await KvHelper.save(CommentumKeys.session, jsonEncode(data));
    }
  }

  // 4. Lean comment creation - NO user_info bloat!
  Future<Comment?> createComment({
    required String mediaId,
    required String mediaType,
    required String mediaTitle,
    required String content,
    int? tag,
    List<String>? labels,
    int? parentId,
  }) async {
    await ensureAuthenticated();

    final response = await http.post(
      Uri.parse('$baseUrl/comments'),
      headers: authHeaders,
      body: jsonEncode({
        'media_id': mediaId,
        'media_type': mediaType,
        'media_title': mediaTitle,
        'content': content,
        'tag': tag,
        'labels': labels,
        'parent_id': parentId,
      }),
    );

    if (response.statusCode == 201) {
      return Comment.fromJson(jsonDecode(response.body)['comment']);
    }
    return null;
  }
}
```

---

## 16. Step-by-Step Implementation Roadmap & Live Progress

### Status Summary
- **Phase 1 (Auth & JWT Subsystem):** ✅ Completed (`df147f6`)
- **Phase 2 (Comments & Media Modernization):** ✅ Completed (`d36eaf7`)
- **Phase 3 (Votes, Reports & Moderation):** ✅ Completed (`6c75346`)
- **Phase 4 (Users, Customizations & Points):** ✅ Completed (`a10b258`)
- **Phase 5 (Notifications & Announcements):** ✅ Completed
- **Phase 6 (Sync, Export & Portability):** ✅ Completed
- **Phase 7 (Database Performance & Migrations):** ✅ Completed
- **Phase 8 (OpenAPI 3.1 & Documentation):** ✅ Completed
- **Phase 9 (Automated Test Suite & Verification):** ✅ Completed (25/25 Tests Passing)
- **Phase 10 (App-Side Integration):** ⏸️ Deferred until backend is signed off by user

```
[x] Phase 1: Auth & Cryptographic JWT Subsystem (Commit df147f6)
    ├── [x] 1.1 Create supabase/functions/shared/jwt.ts (HMAC-SHA256 signer, verifier, claims extractor)
    ├── [x] 1.2 Implement POST /auth/login with multi-provider token verification (AniList, MAL, Simkl)
    ├── [x] 1.3 Implement GET /auth/me and POST /auth/refresh
    └── [x] 1.4 Create reusable getAuthUser(req) middleware in supabase/functions/shared/authMiddleware.ts

[x] Phase 2: Comments & Media Modernization (Commit d36eaf7)
    ├── [x] 2.1 Refactor supabase/functions/comments/index.ts to require Bearer JWT (strip user_info)
    ├── [x] 2.2 Refactor supabase/functions/media/index.ts to require Bearer JWT and inject user_vote
    ├── [x] 2.3 Ensure Discord notifications receive verified user data
    └── [x] 2.4 Verify cross-client media merge (media_id_map)

[x] Phase 3: Votes, Reports & Moderation (Commit 6c75346)
    ├── [x] 3.1 Refactor supabase/functions/votes/index.ts to use verified user from JWT
    ├── [x] 3.2 Refactor supabase/functions/reports/index.ts (create report uses verified user, resolve uses JWT mod role)
    └── [x] 3.3 Refactor supabase/functions/moderation/index.ts to verify role directly from JWT

[x] Phase 4: Users, Customizations & Points (Commit a10b258)
    ├── [x] 4.1 Update supabase/functions/users/index.ts (profile customization & linking via JWT)
    ├── [x] 4.2 Update supabase/functions/points/index.ts to calculate points on verified actions
    └── [x] 4.3 Verify optimizations in supabase/functions/customizations/index.ts

[x] Phase 5: Push Notifications & Announcements
    ├── [x] 5.1 Refactor supabase/functions/notifications/index.ts to bind FCM tokens to verified JWT users
    ├── [x] 5.2 Add Bearer JWT verification to announcements CRUD, staff dashboard, and unread counters
    └── [x] 5.3 Enhance customizations CORS and caching headers

[x] Phase 6: Sync, Export & Portability
    ├── [x] 6.1 Enhance backup-table/index.ts with Bearer JWT owner/super_admin authorization
    └── [x] 6.2 Implement export_my_data in users/index.ts for complete user data export

[x] Phase 7: Edge & Database Performance Optimizations
    └── [x] 7.1 Create migration 042_performance_composite_indexes.sql for high-throughput query acceleration

[x] Phase 8: Comprehensive OpenAPI 3.1 & Developer Documentation
    ├── [x] 8.1 Generate docs/openapi.json (OpenAPI 3.1.0 standard)
    ├── [x] 8.2 Overhaul docs/ACTIONS.md with modern JWT architecture
    └── [x] 8.3 Overhaul docs/COMPLETE_API_REFERENCE.md with full endpoint guide & zero legacy references

[x] Phase 9: Automated Test Suite & Verification
    ├── [x] 9.1 Create scripts/test_jwt_and_endpoints.ts for automated JWT and role assertion
    ├── [x] 9.2 Add CORS & dynamic base URL to health/index.ts and ping/index.ts
    └── [x] 9.3 Run verification suite via Bun (25 passed, 0 failed)

[ ] Phase 10: Client Integration (AnymeX) & E2E Validation (Deferred per user request)
    ├── [ ] 10.1 Implement ensureAuthenticated() & token caching in AnymeX CommentumService
    ├── [ ] 10.2 Strip user_info parameters from comment, vote, and report calls
    └── [ ] 10.3 Execute full suite test (Post comment -> Discord alert -> Push notification -> Points update)
```

