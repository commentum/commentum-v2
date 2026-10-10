# Complete API Reference - Commentum v2 Backend Service

**🎯 IMPORTANT**: This is a **backend API service** documentation. These endpoints are designed for apps to integrate with, not for end users to access directly.

**Base URL**: `http://anymex.duckdns.org:8000/functions/v1/`

**🔑 TOKEN-BASED AUTH** - Mod+ actions require `client_type` + `access_token`. Dantotsu 2-way sync requires provider/AniList tokens (`token` or `anilist_token`).

---

## 🚀 Overview

### What is Commentum v2?

Commentum v2 is a **comment backend API service** that provides:

- Comment CRUD operations
- Voting system
- Content reporting
- Advanced moderation
- Multi-platform support (AniList, MyAnimeList, SIMKL)

**Apps integrate with this backend via REST API calls.**

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Comments API](#comments-api)
3. [Votes API](#votes-api)
4. [Reports API](#reports-api)
5. [Moderation API](#moderation-api)
6. [Users API](#users-api)
7. [Media API](#media-api)
8. [Announcements API](#announcements-api)
9. [Error Handling](#error-handling)

---

## 🔐 Authentication

### Token-Based Authentication (Mod+ Actions)

All moderation and admin actions require **token-based authentication**:

```json
{
  "client_type": "anilist",
  "access_token": "user_oauth_token_from_provider"
}
```

The backend verifies the token with the appropriate provider API:

| Provider | API Endpoint | Returns |
|----------|--------------|---------|
| **AniList** | `graphql.anilist.co` | `id`, `name`, `avatar` |
| **MAL** | `api.myanimelist.net/v2/users/@me` | `id`, `name`, `picture` |
| **SIMKL** | `api.simkl.com/users/settings` | `account.id`, `user.name` |

### Frontend-Provided User Information

Basic operations use `user_info` objects:

```json
{
  "user_info": {
    "user_id": "12345",
    "username": "TestUser",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

### When Token Auth is Required

| Endpoint | Operation | Local Commentum Auth | Dantotsu 2-Way Sync Auth |
|----------|-----------|----------------------|--------------------------|
| `/comments` | Create | ❌ No (`user_info` only) | ✅ `token` (AniList) or `anilist_token` (MAL/SIMKL) |
| `/comments` | Edit | ❌ No (`user_id` match only) | ✅ `token` (AniList) or `anilist_token` (MAL/SIMKL) |
| `/comments` | Delete (own) | ❌ No (`user_id` match only) | ✅ `token` (AniList) or `anilist_token` (MAL/SIMKL) |
| `/comments` | mod_delete (others) | ✅ Token required | ⚡ Automatic (Handled by backend) |
| `/votes` | Vote | ❌ No (`user_info` only) | ⚡ Optional `token` / `anilist_token` (or automatic fallback) |
| `/media` | Get comments | ❌ No | ❌ No |
| `/reports` | Create report | ❌ No | ⚡ Automatic (Handled by backend) |
| `/reports` | Resolve report | ✅ Token required | ⚡ Automatic (Handled by backend) |
| `/reports` | Get queue | ✅ Token required | ❌ No |
| `/moderation` | All actions | ✅ Token required | N/A |
| `/users` | All actions | ✅ Token required | N/A |

> **💡 Dantotsu Sync Note**: Basic Commentum operations never block or fail if tokens are omitted. If tokens are not provided, actions are saved locally as `AnymeX Only`. Providing valid tokens automatically triggers background two-way sync with Dantotsu.

---

## 💬 Comments API

### Endpoint: `/comments`

**Method**: `POST`

**Content-Type**: `application/json`

---

### 1. Create Comment

**Auth**: Not required for local storage; **Token required for Dantotsu sync**.

```json
{
  "action": "create",
  "client_type": "anilist",
  "token": "user_oauth_token_here",
  "anilist_token": "optional_anilist_token_for_mal_or_simkl",
  "user_info": {
    "user_id": "12345",
    "username": "TestUser",
    "avatar": "https://example.com/avatar.jpg"
  },
  "media_info": {
    "media_id": "6789",
    "type": "anime",
    "title": "Attack on Titan",
    "year": 2013,
    "poster": "https://example.com/poster.jpg"
  },
  "content": "This was an amazing episode!",
  "parent_id": null,
  "tag": 1
}
```

**Parameters for Dantotsu Sync:**
- `token` (or `access_token`): User's OAuth token for their `client_type`. For `anilist` users, this token is used to log in to Dantotsu and mirror the comment to Dantotsu.
- `anilist_token`: Optional AniList token for non-AniList users (`mal` or `simkl`). If supplied, Commentum resolves the MAL/SIMKL media to an AniList ID and mirrors the comment to Dantotsu as this AniList user.
- `tag`: Episode number (integer or numeric string) for episode-specific spoiler comments (e.g. `1` for Episode 1).

**Response (201):**
```json
{
  "success": true,
  "comment": { /* comment object */ }
}
```

---

### 2. Edit Comment

**Auth**: user_info (owner only)

```json
{
  "action": "edit",
  "comment_id": 1,
  "user_info": {
    "user_id": "12345",
    "username": "TestUser"
  },
  "content": "Updated comment text"
}
```

---

### 3. Delete Comment (Own)

**Auth**: user_info (owner only)

```json
{
  "action": "delete",
  "comment_id": 1,
  "user_info": {
    "user_id": "12345",
    "username": "TestUser"
  }
}
```

---

### 4. Mod Delete Comment (Other's)

**Auth**: ✅ Token required (moderator+)

```json
{
  "action": "mod_delete",
  "comment_id": 1,
  "client_type": "anilist",
  "access_token": "user_oauth_token_here"
}
```

**Response (200):**
```json
{
  "success": true,
  "comment": { /* deleted comment */ },
  "moderator": {
    "id": "67890",
    "username": "ModeratorUser",
    "role": "admin"
  }
}
```

---

## 🗳️ Votes API

### Endpoint: `/votes`

**Method**: `POST`

**Auth**: Not required for local vote; **Optional token for Dantotsu sync**

```json
{
  "comment_id": 1,
  "user_info": {
    "user_id": "12345",
    "username": "TestUser"
  },
  "vote_type": "upvote",
  "token": "optional_user_oauth_token",
  "anilist_token": "optional_anilist_token_for_dantotsu_sync"
}
```

- **vote_type**: `"upvote"`, `"downvote"`, or `"remove"`
- **token** / **anilist_token**: If the target comment is mapped to a Dantotsu comment ID, providing this token syncs the vote to Dantotsu in the background. If omitted, the server attempts to use a Dantotsu mod token.

**Response (200):**
```json
{
  "success": true,
  "voteScore": 5,
  "upvotes": 6,
  "downvotes": 1,
  "userVote": "upvote"
}
```

---

## 🚨 Reports API

### Endpoint: `/reports`

**Method**: `POST`

---

### 1. Create Report

**Auth**: Not required

```json
{
  "action": "create",
  "comment_id": 1,
  "reporter_info": {
    "user_id": "12345",
    "username": "TestUser"
  },
  "reason": "spam",
  "notes": "This looks like automated spam"
}
```

**Valid Reasons**: `spam`, `offensive`, `harassment`, `spoiler`, `nsfw`, `off_topic`, `other`

---

### 2. Resolve Report

**Auth**: ✅ Token required (moderator+)

```json
{
  "action": "resolve",
  "comment_id": 1,
  "client_type": "anilist",
  "access_token": "user_oauth_token_here",
  "reporter_info": { "user_id": "12345" },
  "resolution": "resolved",
  "review_notes": "Confirmed spam, removed"
}
```

**resolution**: `"resolved"` or `"dismissed"`

---

### 3. Get Reports Queue

**Auth**: ✅ Token required (moderator+)

```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "access_token": "user_oauth_token_here"
}
```

---

## 🔧 Moderation API

### Endpoint: `/moderation`

**Method**: `POST`

**Auth**: ✅ Token required for all actions

---

### Common Parameters

All moderation actions require:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Moderation action type |
| `client_type` | string | ✅ | `"anilist"`, `"mal"`, `"simkl"` |
| `access_token` | string | ✅ | OAuth token from provider |

---

### Actions

#### Pin Comment
```json
{
  "action": "pin_comment",
  "comment_id": 1,
  "client_type": "anilist",
  "access_token": "...",
  "reason": "Important announcement"
}
```

#### Unpin Comment
```json
{
  "action": "unpin_comment",
  "comment_id": 1,
  "client_type": "anilist",
  "access_token": "...",
  "reason": "No longer relevant"
}
```

#### Lock Thread
```json
{
  "action": "lock_thread",
  "comment_id": 1,
  "client_type": "anilist",
  "access_token": "...",
  "reason": "Off-topic discussion"
}
```

#### Unlock Thread
```json
{
  "action": "unlock_thread",
  "comment_id": 1,
  "client_type": "anilist",
  "access_token": "...",
  "reason": "Discussion can continue"
}
```

#### Warn User
```json
{
  "action": "warn_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "access_token": "...",
  "reason": "Multiple rule violations"
}
```

#### Ban User (Admin+)
```json
{
  "action": "ban_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "access_token": "...",
  "reason": "Repeated spam",
  "shadow_ban": false
}
```

#### Unban User (Admin+)
```json
{
  "action": "unban_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "access_token": "...",
  "reason": "Appeal approved"
}
```

#### Get Moderation Queue
```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "access_token": "..."
}
```

---

## 👤 Users API

### Endpoint: `/users`

**Method**: `POST`

**Auth**: ✅ Token required for all actions

---

### Actions

#### Get User Info
```json
{
  "action": "get_user_info",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist"
}
```

#### Get User Stats
```json
{
  "action": "get_user_stats",
  "client_type": "anilist",
  "access_token": "...",
  "target_client_type": "anilist"
}
```

#### Warn User
```json
{
  "action": "warn_user",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist",
  "reason": "Rule violation"
}
```

#### Mute User
```json
{
  "action": "mute_user",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist",
  "reason": "Temporary mute",
  "duration": 24
}
```

#### Unmute User
```json
{
  "action": "unmute_user",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist",
  "reason": "Mute expired"
}
```

#### Ban User (Admin+)
```json
{
  "action": "ban_user",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist",
  "reason": "Repeated violations"
}
```

#### Unban User (Admin+)
```json
{
  "action": "unban_user",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist",
  "reason": "Appeal approved"
}
```

#### Get User History
```json
{
  "action": "get_user_history",
  "client_type": "anilist",
  "access_token": "...",
  "target_user_id": "12345",
  "target_client_type": "anilist"
}
```

---

## 📺 Media API

### Endpoint: `/media`

**Method**: `GET`

**Auth**: Not required

---

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `media_id` | string | ✅ | - | Media identifier |
| `client_type` | string | ✅ | - | Platform identifier |
| `page` | integer | ❌ | 1 | Page number |
| `limit` | integer | ❌ | 50 | Results per page |
| `sort` | string | ❌ | newest | Sort order |

**Sort Options**: `newest`, `oldest`, `top`, `controversial`

**Example:**
```
GET /media?media_id=6789&client_type=anilist&page=1&limit=20&sort=top
```

**Response (200):**
```json
{
  "media": {
    "mediaId": "6789",
    "mediaType": "anime",
    "mediaTitle": "Attack on Titan",
    "mediaYear": 2023,
    "mediaPoster": "https://example.com/poster.jpg"
  },
  "comments": [ /* nested comment structure */ ],
  "stats": {
    "commentCount": 150,
    "totalUpvotes": 500,
    "totalDownvotes": 50,
    "netScore": 450
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## 📢 Announcements API

### Endpoint: `/announcements`

Multi-app announcement system for developer communications.

---

### 1. List Announcements

**Method**: `GET`

**Auth**: Not required (public)

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `app_id` | string | ✅ | - | App ID (anymex/shonenx/animestream) |
| `status` | string | ❌ | published | Filter by status |
| `category` | string | ❌ | - | Filter by category |
| `page` | integer | ❌ | 1 | Page number |
| `limit` | integer | ❌ | 20 | Results per page (max 50) |
| `user_id` | string | ❌ | - | For read status |
| `include_read` | boolean | ❌ | false | Include read status |

**Example:**
```
GET /announcements?app_id=anymex&status=published&page=1&limit=20
```

**Response (200):**
```json
{
  "success": true,
  "announcements": [
    {
      "id": 1,
      "title": "New Feature Release",
      "short_description": "We've added a new feature...",
      "category": "feature",
      "pinned": true,
      "featured": false,
      "priority": 10,
      "published_at": "2024-01-15T10:00:00Z",
      "author_name": "Dev Team",
      "view_count": 150,
      "is_read": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "total_pages": 3
  },
  "unread_count": 5
}
```

---

### 2. Get Single Announcement

**Method**: `GET`

**Auth**: Not required (public)

**Example:**
```
GET /announcements/1?user_id=12345&app_id=anymex
```

**Response (200):**
```json
{
  "success": true,
  "announcement": {
    "id": 1,
    "app_id": "anymex",
    "title": "New Feature Release",
    "short_description": "We've added a new feature...",
    "full_content": "# Full markdown content here...",
    "author_id": "dev123",
    "author_name": "Dev Team",
    "category": "feature",
    "priority": 10,
    "status": "published",
    "pinned": true,
    "featured": false,
    "published_at": "2024-01-15T10:00:00Z",
    "expires_at": null,
    "view_count": 151,
    "is_read": false
  }
}
```

---

### 3. Get Unread Count

**Method**: `GET`

**Auth**: Not required

**Example:**
```
GET /announcements/unread-count?user_id=12345&app_id=anymex
```

**Response (200):**
```json
{
  "success": true,
  "total_published": 45,
  "read_count": 40,
  "unread_count": 5
}
```

---

### 4. Create Announcement (Admin Only)

**Method**: `POST`

**Auth**: ✅ Token required (owner/super_admin only)

```json
{
  "client_type": "anilist",
  "access_token": "admin_oauth_token",
  "app_id": "anymex",
  "title": "New Feature Release",
  "short_description": "We've added a new feature...",
  "full_content": "# Full markdown content here...",
  "category": "feature",
  "priority": 10,
  "pinned": false,
  "featured": false,
  "expires_at": null,
  "publish": true
}
```

**Response (201):**
```json
{
  "success": true,
  "announcement": { /* announcement object */ },
  "message": "Announcement published successfully"
}
```

---

### 5. Update Announcement (Admin Only)

**Method**: `PATCH`

**Auth**: ✅ Token required (owner/super_admin only)

```
PATCH /announcements/1
```

```json
{
  "client_type": "anilist",
  "access_token": "admin_oauth_token",
  "title": "Updated Title",
  "priority": 20,
  "pinned": true
}
```

---

### 6. Delete Announcement (Admin Only)

**Method**: `DELETE`

**Auth**: ✅ Token required (owner/super_admin only)

```
DELETE /announcements/1
```

```json
{
  "client_type": "anilist",
  "access_token": "admin_oauth_token"
}
```

---

### 7. Publish Draft (Admin Only)

**Method**: `POST`

**Auth**: ✅ Token required (owner/super_admin only)

```
POST /announcements/1/publish
```

```json
{
  "client_type": "anilist",
  "access_token": "admin_oauth_token"
}
```

**Note:** Publishing sends a Discord notification to the configured channel.

---

### 8. Archive Announcement (Admin Only)

**Method**: `POST`

**Auth**: ✅ Token required (owner/super_admin only)

```
POST /announcements/1/archive
```

```json
{
  "client_type": "anilist",
  "access_token": "admin_oauth_token"
}
```

---

### 9. Mark as Viewed

**Method**: `POST`

**Auth**: Not required

```
POST /announcements/1/view
```

```json
{
  "user_id": "12345",
  "app_id": "anymex"
}
```

---

### 10. Mark as Read

**Method**: `POST`

**Auth**: Not required

```
POST /announcements/1/read
```

```json
{
  "user_id": "12345",
  "app_id": "anymex"
}
```

---

## ❌ Error Handling

### Standard Error Response

```json
{
  "error": "Error description"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized (invalid/expired token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

---

## 🔑 Token Verification Flow

1. **Client sends**: `client_type` + `access_token`
2. **Backend verifies**: Calls provider API
3. **Provider returns**: `provider_user_id`, `username`, `avatar_url`
4. **Backend checks**: Role from database
5. **Action executed**: If role is sufficient

---

## 📊 Action Matrix

| Action | Endpoint | Auth | Min Role |
|--------|----------|------|----------|
| create | /comments | user_info | user |
| edit | /comments | user_info (owner) | user |
| delete | /comments | user_info (owner) | user |
| mod_delete | /comments | token | moderator |
| vote | /votes | user_info | user |
| create_report | /reports | user_info | user |
| resolve_report | /reports | token | moderator |
| get_queue | /reports | token | moderator |
| pin/unpin | /moderation | token | moderator |
| lock/unlock | /moderation | token | moderator |
| warn_user | /moderation | token | moderator |
| ban_user | /moderation | token | admin |
| unban_user | /moderation | token | admin |
| get_queue | /moderation | token | moderator |
| get_user_* | /users | token | moderator |
| warn_user | /users | token | moderator |
| mute_user | /users | token | moderator |
| ban_user | /users | token | admin |
| unban_user | /users | token | admin |
| get_media | /media | none | - |
| list_announcements | /announcements | none | - |
| get_announcement | /announcements/:id | none | - |
| get_unread_count | /announcements/unread-count | none | - |
| mark_viewed | /announcements/:id/view | none | - |
| mark_read | /announcements/:id/read | none | - |
| create_announcement | /announcements | token | super_admin |
| update_announcement | /announcements/:id | token | super_admin |
| delete_announcement | /announcements/:id | token | super_admin |
| publish_announcement | /announcements/:id/publish | token | super_admin |
| archive_announcement | /announcements/:id/archive | token | super_admin |

---

## 🔄 Dantotsu 2-Way Sync

Commentum v2 supports real-time, bidirectional synchronization with the **Dantotsu** comment ecosystem.

### Key Capabilities
1. **Comment Creation**: When an AnymeX user posts a comment, it is mirrored to Dantotsu in real time and tracked in `dantotsu_id_mappings`.
2. **Comment Editing**: Edits made on AnymeX reflect on Dantotsu.
3. **Comment Deletion**: Both self-deletes and moderator deletes (via API or Discord bot buttons) delete the corresponding Dantotsu comment.
4. **Voting**: Upvotes and downvotes cast in AnymeX sync to Dantotsu.
5. **Cross-Client Media Resolution**: MAL and SIMKL media IDs are automatically resolved to AniList IDs so non-AniList users can still sync with Dantotsu.
6. **Discord Embed Tracking**: All Discord notification embeds show sync status:
   - `Dantotsu: Synced (#<id>)`
   - `Dantotsu: Posted on Dantotsu (#<id>)`
   - `Dantotsu: AnymeX Only`

### Token Requirements for Dantotsu Sync

| Client Type | Field to Provide | Requirement | Notes |
|-------------|------------------|-------------|-------|
| `anilist` | `token` or `access_token` | **Required** for sync | User's AniList OAuth token; used to log in to Dantotsu API |
| `mal` | `anilist_token` | Optional | If linked, syncs to Dantotsu using this AniList account |
| `simkl` | `anilist_token` | Optional | If linked, syncs to Dantotsu using this AniList account |
| Moderator actions | None from app | **Automatic** | Backend uses internal moderator token pool to mirror deletions/reports to Dantotsu |

> ⚠️ If tokens are omitted, the action succeeds locally on Commentum without failing, but Dantotsu sync is skipped (`AnymeX Only`).

---

**Ready to integrate?** Start with the [Quick Start Guide](./QUICK_START.md)! 🚀

