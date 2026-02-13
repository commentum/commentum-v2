# Complete API Reference - Commentum v2 Backend Service

**🎯 IMPORTANT**: This is a **backend API service** documentation. These endpoints are designed for apps to integrate with, not for end users to access directly.

**Base URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

**🔑 TOKEN-BASED AUTH** - Mod+ actions require `client_type` + `access_token` for verification with provider APIs.

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
8. [Error Handling](#error-handling)

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

| Endpoint | Operation | Auth Required |
|----------|-----------|---------------|
| `/comments` | Create | ❌ No |
| `/comments` | Edit | ❌ No (user_id match only) |
| `/comments` | Delete (own) | ❌ No (user_id match only) |
| `/comments` | mod_delete (others) | ✅ Token required |
| `/votes` | Vote | ❌ No |
| `/media` | Get comments | ❌ No |
| `/reports` | Create report | ❌ No |
| `/reports` | Resolve report | ✅ Token required |
| `/reports` | Get queue | ✅ Token required |
| `/moderation` | All actions | ✅ Token required |
| `/users` | All actions | ✅ Token required |

---

## 💬 Comments API

### Endpoint: `/comments`

**Method**: `POST`

**Content-Type**: `application/json`

---

### 1. Create Comment

**Auth**: Not required

```json
{
  "action": "create",
  "client_type": "anilist",
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
  "tag": "1"
}
```

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

**Auth**: Not required

```json
{
  "comment_id": 1,
  "user_info": {
    "user_id": "12345",
    "username": "TestUser"
  },
  "vote_type": "upvote"
}
```

**vote_type**: `"upvote"`, `"downvote"`, or `"remove"`

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

---

**Ready to integrate?** Start with the [Quick Start Guide](./QUICK_START.md)! 🚀
