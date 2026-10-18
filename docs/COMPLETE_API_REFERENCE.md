# Commentum v2 — Complete API Reference Manual

> **Production Edge Function Base URL**: `https://<project-ref>.supabase.co/functions/v1/`  
> **Protocol**: HTTPS / JSON  
> **Authentication Standard**: RFC 6750 Bearer Tokens (HMAC-SHA256 JWT)  
> **CORS**: Supported (`*`) with complete preflight negotiation

---

## 📋 Table of Contents
1. [Architecture & Authentication Subsystem](#1-architecture--authentication-subsystem)
2. [Comments API (`/comments`)](#2-comments-api-comments)
3. [Media & Comment Tree API (`/media`)](#3-media--comment-tree-api-media)
4. [Votes API (`/votes`)](#4-votes-api-votes)
5. [Reports API (`/reports`)](#5-reports-api-reports)
6. [Moderation Controls (`/moderation`)](#6-moderation-controls-moderation)
7. [Users, Profiles & Customizations (`/users`)](#7-users-profiles--customizations-users)
8. [Points, Streaks & Leaderboard (`/points`)](#8-points-streaks--leaderboard-points)
9. [Notifications & FCM Push (`/notifications`)](#9-notifications--fcm-push-notifications)
10. [Announcements System (`/announcements`)](#10-announcements-system-announcements)
11. [Data Export & Portability (`/users`)](#11-data-export--portability-users)
12. [System Health & Diagnostics (`/health`, `/ping`)](#12-system-health--diagnostics-health-ping)
13. [Standard Error Handling & Status Codes](#13-standard-error-handling--status-codes)

---

## 1. Architecture & Authentication Subsystem

Commentum v2 operates on a **high-performance Session Token architecture**. Rather than validating heavy third-party OAuth access tokens on every incoming request, clients exchange their third-party provider token once during login. The backend validates the provider credentials, synchronizes the user profile in `commentum_users`, and issues a signed HMAC-SHA256 JSON Web Token (JWT).

### Token Lifecycle
1. **Login**: Client submits provider credentials (`anilist`, `myanimelist`, or `simkl`) to `POST /auth/login`.
2. **Session**: Backend signs a cryptographic JWT with 7-day validity containing verified identity and role claims.
3. **Execution**: Subsequent requests pass `Authorization: Bearer <session_token>`. Token verification completes locally in `<1ms` via Web Crypto with zero network calls and zero database bottlenecks.
4. **Anti-Spoofing Guarantee**: When a token is provided, identity claims (`uid`, `username`, `role`, `provider`) are cryptographically verified and strictly supersede any caller-provided body parameters.

---

### `POST /auth/login`
Exchange third-party OAuth credentials for a Commentum session token.

#### Request Headers
```http
Content-Type: application/json
```

#### Request Body
```json
{
  "provider": "anilist",
  "token": "an_oauth_access_token_from_anilist"
}
```
*Supported providers: `"anilist"`, `"myanimelist"` (or `"mal"`), `"simkl"`.*

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbmlsaXN0OjU3MjQwMTciLCJ1aWQiOiI1NzI0MDE3IiwicHJvdmlkZXIiOiJhbmlsaXN0IiwidXNlcm5hbWUiOiJTaGVieSIsInJvbGUiOiJvd25lciIsImlhdCI6MTcyOTI0MjAwMCwiZXhwIjoxNzI5ODQ2ODAwfQ...",
  "token_type": "Bearer",
  "expires_in": 604800,
  "user": {
    "uid": "5724017",
    "username": "Sheby",
    "provider": "anilist",
    "role": "owner",
    "avatar": "https://s4.anilist.co/user/avatar/medium/...",
    "points": 1450,
    "streak": 12,
    "unlocked_customizations": ["badge_cyber", "frame_neon"]
  }
}
```

---

### `GET /auth/me`
Inspect current session status and token claims.

#### Request Headers
```http
Authorization: Bearer <session_token>
```

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "authenticated": true,
  "user": {
    "uid": "5724017",
    "username": "Sheby",
    "provider": "anilist",
    "role": "owner",
    "avatar": "https://s4.anilist.co/user/avatar/medium/...",
    "points": 1450,
    "streak": 12
  }
}
```

---

### `POST /auth/refresh`
Renew an unexpired session token for an additional 7 days.

#### Request Headers
```http
Authorization: Bearer <session_token>
```

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "session_token": "<new_jwt_string>",
  "token_type": "Bearer",
  "expires_in": 604800
}
```

---

## 2. Comments API (`/comments`)

Handles creating, editing, and deleting comments and replies.

### `POST /comments` — Create Comment
Creates a new root comment or reply to an existing comment.

#### Request Headers
```http
Authorization: Bearer <session_token>
Content-Type: application/json
```

#### Request Body
```json
{
  "action": "create",
  "media_id": "16498",
  "media_type": "anime",
  "media_title": "Attack on Titan",
  "content": "The animation in this episode is breathtaking!",
  "parent_id": null,
  "tags": ["spoiler"]
}
```
*Note: To create a reply, provide the parent comment ID in `parent_id`.*

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "comment": {
    "id": 14092,
    "client_type": "anilist",
    "user_id": "5724017",
    "username": "Sheby",
    "user_avatar": "https://s4.anilist.co/user/avatar/medium/...",
    "user_role": "owner",
    "media_id": "16498",
    "media_type": "anime",
    "media_title": "Attack on Titan",
    "content": "The animation in this episode is breathtaking!",
    "parent_id": null,
    "upvotes": 0,
    "downvotes": 0,
    "vote_score": 0,
    "created_at": "2026-10-18T03:30:00.000Z"
  }
}
```

---

### `POST /comments` — Edit Comment
Updates the textual content of a comment. Only the author may edit their comment.

#### Request Body
```json
{
  "action": "edit",
  "comment_id": 14092,
  "content": "Edited: The animation and sound design in this episode are breathtaking!"
}
```

---

### `POST /comments` — Delete Comment
Deletes a comment. If invoked by the author, deletes their own comment. If invoked by a moderator or admin (`moderator+`), performs a staff deletion and logs the action.

#### Request Body
```json
{
  "action": "delete",
  "comment_id": 14092,
  "reason": "Off-topic discussion"
}
```

---

## 3. Media & Comment Tree API (`/media`)

Fetches discussions for a specific media item. Requires authentication to ensure secure community access.

### `GET /media`
Retrieves the comment thread hierarchy for an anime, manga, or novel.

#### Request Headers
```http
Authorization: Bearer <session_token>
```

#### Query Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| `media_id` | String | Yes | Unique ID of media (e.g. `16498`) |
| `client_type` | String | No | Target platform (`anilist`, `myanimelist`, `simkl`). Defaults to token provider. |
| `page` | Integer | No | Page number for root comments (default: `1`). |
| `limit` | Integer | No | Number of root comments per page (default: `30`, max: `100`). |
| `sort` | String | No | Sort order: `best` (highest score), `newest`, `oldest`. |

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "media_id": "16498",
  "comments": [
    {
      "id": 14092,
      "user_id": "5724017",
      "username": "Sheby",
      "user_avatar": "https://s4.anilist.co/user/avatar/medium/...",
      "user_role": "owner",
      "avatar_decoration": "neon_frame_01",
      "banner_url": "https://cdn.example.com/banner.gif",
      "nameplate_theme": "cyber_blue",
      "content": "The animation in this episode is breathtaking!",
      "upvotes": 42,
      "downvotes": 1,
      "vote_score": 41,
      "pinned": true,
      "user_vote": 1,
      "user_vote_type": "upvote",
      "replies": [
        {
          "id": 14095,
          "parent_id": 14092,
          "user_id": "992144",
          "username": "AnimeFan",
          "content": "Agreed, MAPPA went all out!",
          "user_vote": 0
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 128,
    "total_pages": 5
  }
}
```
*Note: The response automatically calculates and injects `user_vote: 1 | -1 | 0` and `user_vote_type` tailored to the requesting token user.*

---

## 4. Votes API (`/votes`)

Atomic upvoting and downvoting with automatic counter synchronization.

### `POST /votes`
Cast an upvote, downvote, or remove an existing vote.

#### Request Headers
```http
Authorization: Bearer <session_token>
Content-Type: application/json
```

#### Request Body
```json
{
  "comment_id": 14092,
  "vote_type": 1
}
```
*Supported `vote_type` values:*
- `1` or `"upvote"`: Upvote (+1)
- `-1` or `"downvote"`: Downvote (-1)
- `0` or `"remove"`: Clear vote

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "action": "cast",
  "vote_type": "upvote",
  "vote_score": 42,
  "upvotes": 43,
  "downvotes": 1,
  "user_vote": 1
}
```

---

## 5. Reports API (`/reports`)

User reporting and moderation queue handling.

### `POST /reports` — Submit Report
File a report against a comment violating community standards.

#### Request Headers
```http
Authorization: Bearer <session_token>
Content-Type: application/json
```

#### Request Body
```json
{
  "action": "report",
  "comment_id": 14092,
  "reason": "spoiler",
  "notes": "Untagged spoilers for chapter 139"
}
```
*Valid reasons: `"spam"`, `"offensive"`, `"harassment"`, `"spoiler"`, `"nsfw"`, `"off_topic"`, `"other"`.*

---

### `POST /reports` — Moderation Queue (`moderator+`)
Retrieve pending reports awaiting staff review.

#### Request Body
```json
{
  "action": "get_queue",
  "page": 1,
  "limit": 20
}
```

---

### `POST /reports` — Resolve Report (`moderator+`)
Resolve or dismiss a filed report.

#### Request Body
```json
{
  "action": "resolve",
  "comment_id": 14092,
  "reporter_id": "992144",
  "resolution": "resolved",
  "notes": "Comment flagged as spoiler and hidden"
}
```

---

## 6. Moderation Controls (`/moderation`)

Staff operations for maintaining community standards. Verifies staff role directly from token in `<1ms`.

### `POST /moderation`
| Action | Min Role | Required Parameters | Description |
|---|---|---|---|
| `pin_comment` | `moderator` | `comment_id` | Pins comment to the top of the media thread |
| `unpin_comment` | `moderator` | `comment_id` | Unpins comment |
| `lock_thread` | `moderator` | `comment_id` | Prevents further replies in this comment thread |
| `unlock_thread` | `moderator` | `comment_id` | Unlocks thread |
| `warn_user` | `moderator` | `target_user_id`, `reason` | Issues a warning strike to the user |
| `mute_user` | `moderator` | `target_user_id`, `duration` | Mutes user for N hours |
| `unmute_user` | `moderator` | `target_user_id` | Removes active mute |
| `ban_user` | `admin` | `target_user_id`, `reason` | Bans user from participating |
| `unban_user` | `admin` | `target_user_id` | Unbans user |

---

## 7. Users, Profiles & Customizations (`/users`)

Manage user profiles, unlock cosmetics with earned points, and link accounts.

### `POST /users` — Get Profile
Fetch authenticated user profile details, active cosmetics, and points.

#### Request Body
```json
{
  "action": "get_profile"
}
```

---

### `POST /users` — Update Customizations
Equip unlocked decorations, banners, nameplates, or profile effects.

#### Request Body
```json
{
  "action": "update_customizations",
  "avatar_decoration": "neon_frame_01",
  "banner_url": "https://cdn.example.com/banners/cyberpunk.png",
  "nameplate_theme": "cyber_blue",
  "profile_effect_url": "https://cdn.example.com/effects/sakura.webm"
}
```

---

### `POST /users` — Unlock Customization Item
Spend earned engagement points to unlock cosmetic assets from the catalog.

#### Request Body
```json
{
  "action": "unlock_customization",
  "customization_id": "nameplate_gold_dragon"
}
```

---

### `POST /users` — Multi-Provider Account Linking
Link a secondary service (e.g. MyAnimeList or SIMKL) to your primary AniList account.

#### Request Body
```json
{
  "action": "link_account",
  "target_client_type": "myanimelist",
  "target_access_token": "oauth_token_from_myanimelist"
}
```

---

## 8. Points, Streaks & Leaderboard (`/points`)

Reward system for community engagement.

### `GET /points` — Get Status
Fetch points balance, daily active streak, and earning breakdown.

#### Request Headers
```http
Authorization: Bearer <session_token>
```

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "points": 1450,
  "streak": 12,
  "longest_streak": 24,
  "rank": 7,
  "recent_events": [
    { "type": "comment_created", "points": 10, "created_at": "2026-10-18T02:00:00Z" },
    { "type": "daily_login", "points": 25, "created_at": "2026-10-18T00:00:00Z" }
  ]
}
```

---

### `GET /points?action=get_leaderboard`
Fetch global points leaderboard rankings.

#### Query Parameters
- `limit` (optional): Items to return (default: `50`, max: `100`).
- `offset` (optional): Offset for pagination.

---

## 9. Notifications & FCM Push (`/notifications`)

Cross-platform Firebase Cloud Messaging push notifications and in-app inbox.

### `POST /notifications` — Register Device Token
Register or refresh an Android/iOS/Desktop FCM push token.

#### Request Headers
```http
Authorization: Bearer <session_token>
Content-Type: application/json
```

#### Request Body
```json
{
  "action": "register_token",
  "fcm_token": "eXamPLe_FcM_TokEn_123...",
  "platform": "android",
  "app_version": "3.5.0"
}
```

---

### `GET /notifications?action=get_history`
Fetch inbox notification history.

#### Query Parameters
- `page` (optional): Page number (default: `1`).
- `limit` (optional): Max items (default: `30`).
- `unreadOnly` (optional): Filter unread (`true` / `false`).

---

### `POST /notifications` — Mark Read
Mark a single notification or all notifications as read.

#### Request Body (Single)
```json
{
  "action": "mark_read",
  "notification_id": 892
}
```

#### Request Body (All)
```json
{
  "action": "mark_all_read"
}
```

---

## 10. Announcements System (`/announcements`)

Broadcasts, feature rollouts, and changelogs.

### `GET /announcements`
Fetch published announcements feed with automatic read status tracking.

#### Query Parameters
- `app_id` (optional): Application identifier (e.g., `anymex`).
- `category` (optional): Filter category (`release`, `update`, `maintenance`, `general`).
- `page` (optional): Page number.
- `limit` (optional): Page size.

---

### `POST /announcements` — Publish Announcement (`super_admin+`)
Create and broadcast a global announcement.

#### Request Body
```json
{
  "app_id": "anymex",
  "title": "Version 3.5 Released!",
  "short_description": "New video engine, session tokens, and custom nameplates.",
  "full_content": "### What's New in v3.5\n- Faster playback...",
  "category": "release",
  "priority": 10,
  "pinned": true,
  "publish": true
}
```

---

## 11. Data Export & Portability (`/users`)

GDPR and data portability compliance endpoint.

### `POST /users` — Export User Data
Exports user profile, comments, votes, notification preferences, and linked accounts as structured JSON.

#### Request Headers
```http
Authorization: Bearer <session_token>
Content-Type: application/json
```

#### Request Body
```json
{
  "action": "export_my_data"
}
```

#### Successful Response (`200 OK`)
```json
{
  "success": true,
  "exported_at": "2026-10-18T03:35:00.000Z",
  "user": {
    "id": "5724017",
    "client_type": "anilist",
    "username": "Sheby",
    "role": "owner",
    "points": 1450,
    "streak": 12,
    "unlocked_customizations": ["badge_cyber"],
    "linked_accounts": []
  },
  "comments": [...],
  "votes": [...],
  "notification_preferences": {...}
}
```

---

## 12. System Health & Diagnostics (`/health`, `/ping`)

### `GET /ping`
Lightweight heartbeat check. Always returns `200 OK` with `{ "status": "ok", "message": "pong" }`.

### `GET /health`
Comprehensive health check probing all edge functions and database dependencies.

---

## 13. Standard Error Handling & Status Codes

All Commentum v2 endpoints return standard HTTP status codes accompanied by an informative JSON body.

| HTTP Status | Meaning | Typical Scenario |
|---|---|---|
| `200 OK` | Success | Operation succeeded. |
| `201 Created` | Created | Resource (comment, announcement) created. |
| `400 Bad Request` | Invalid Input | Missing required field, text length violation, or invalid action. |
| `401 Unauthorized` | Authentication Failed | Missing or invalid Bearer token / expired session. |
| `403 Forbidden` | Insufficient Permissions | Regular user attempting moderator/admin actions. |
| `404 Not Found` | Not Found | Target comment, user, or media does not exist. |
| `429 Too Many Requests` | Rate Limited | Comment or vote frequency limits exceeded. |
| `500 Internal Server Error`| Server Error | Database failure or unhandled exception. |

#### Standard Error Response Format
```json
{
  "error": "Authentication required to access notifications",
  "status": 401
}
```
