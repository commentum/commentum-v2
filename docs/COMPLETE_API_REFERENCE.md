# Complete API Reference - Commentum v2 Backend Service

**🎯 IMPORTANT**: This is a **backend API service** documentation. These endpoints are designed for apps to integrate with, not for end users to access directly.

**Base URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

**🔑 NO API KEYS REQUIRED** - All endpoints are open and use user_info for identification only.

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

### Integration Model

```
┌─────────────┐           API           ┌──────────────┐
│   Your App  │ ◄──────────────────────► │ Commentum v2 │
│ (Frontend)  │                           │ (Backend API)  │
└─────────────┘                           └──────────────┘
      │                                           │
      │ Displays                                   │ Stores &
      │ Comments                                  │ Moderates
      ▼                                           ▼
   Users                                    PostgreSQL DB
```

### Key Design Principles

- **Open System**: Most operations don't require authentication
- **Frontend-Provided Info**: Uses user_info and media_info from frontend
- **RESTful API**: Simple HTTP endpoints with JSON responses
- **Multi-Tenancy**: Supports multiple apps via `client_type`
- **Server-Side Logic**: All business logic handled by backend

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Comments API](#comments-api)
3. [Votes API](#votes-api)
4. [Reports API](#reports-api)
5. [Moderation API](#moderation-api)
6. [Media API](#media-api)
7. [Users API](#users-api)
8. [Discord API](#discord-api)
9. [Error Handling](#error-handling)
10. [Rate Limiting](#rate-limiting)

---

## 🔐 Authentication

### Frontend-Provided User Information

**Most endpoints are OPEN** - no authentication required!

User identification is provided by the frontend in `user_info` objects:

```json
{
  "user_info": {
    "user_id": "12345",
    "username": "TestUser",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

### Admin/Moderator Verification

Admin and moderator actions use `moderator_info` objects:

```json
{
  "moderator_info": {
    "user_id": "12345",
    "username": "AdminUser"
  }
}
```

The system checks if the user_id is in the database-stored role lists.

### When Authentication is Required

| Endpoint | Operation | Auth Required |
|----------|-----------|---------------|
| `/comments` | Create | ❌ No |
| `/comments` | Edit | ❌ No (user_id match only) |
| `/comments` | Delete (own) | ❌ No (user_id match only) |
| `/comments` | Delete (others) | ✅ Admin only |
| `/votes` | Vote | ❌ No |
| `/media` | Get comments | ❌ No |
| `/reports` | Create report | ❌ No |
| `/reports` | Resolve report | ✅ Admin only |
| `/moderation` | All actions | ✅ Admin only |
| `/users` | Get role | ❌ No |
| `/discord` | Bot commands | ✅ Discord bot |

---

## 💬 Comments API

### Endpoint: `/comments`

Handles all comment-related operations (create, edit, delete).

**Method**: `POST`

**Content-Type**: `application/json`

---

### 1. Create Comment

**Authentication**: Not required (open system)

#### Request Body

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

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"create"` |
| `client_type` | string | ✅ | Platform: `"anilist"`, `"myanimelist"`, `"simkl"`, `"other"` |
| `user_info` | object | ✅ | User information object |
| `user_info.user_id` | string | ✅ | User's platform ID |
| `user_info.username` | string | ✅ | User's display name (1-50 chars) |
| `user_info.avatar` | string | ❌ | User's avatar URL |
| `media_info` | object | ✅ | Media information object |
| `media_info.media_id` | string | ✅ | Media identifier |
| `media_info.type` | string | ✅ | Media type (any string) |
| `media_info.title` | string | ✅ | Media title (1-200 chars) |
| `media_info.year` | integer | ❌ | Media year |
| `media_info.poster` | string | ❌ | Media poster URL |
| `content` | string | ✅ | Comment text (1-10,000 characters) |
| `parent_id` | integer | ❌ | Parent comment ID for replies |
| `tag` | string/number | ❌ | Episode or content identifier |

#### Response (201 Created)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "This was an amazing episode!",
    "username": "UserName",
    "user_avatar": "https://example.com/avatar.jpg",
    "user_role": "user",
    "media_type": "anime",
    "media_title": "Attack on Titan",
    "media_year": 2023,
    "media_poster": "https://example.com/poster.jpg",
    "parent_id": null,
    "created_at": "2023-12-01T10:00:00Z",
    "updated_at": "2023-12-01T10:00:00Z",
    "upvotes": 0,
    "downvotes": 0,
    "vote_score": 0,
    "user_votes": "{}",
    "deleted": false,
    "pinned": false,
    "locked": false,
    "edited": false,
    "edit_count": 0,
    "user_banned": false,
    "user_shadow_banned": false,
    "user_warnings": 0,
    "reported": false,
    "report_count": 0,
    "reports": "[]",
    "report_status": "none",
    "tags": "[]",
    "moderated": false,
    "ip_address": "192.168.1.1",
    "user_agent": "Mozilla/5.0..."
  }
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing required fields | `client_type`, `user_info`, `media_info`, `content` required |
| 400 | Invalid user_info format | `user_info.user_id` and `user_info.username` required |
| 400 | Invalid media_info format | `media_info.media_id`, `media_info.type`, `media_info.title` required |
| 400 | Invalid content length | Content must be 1-10,000 characters |
| 400 | Maximum nesting level exceeded | Reply depth exceeds configured limit |
| 400 | Comment contains prohibited content | Banned keyword detected |
| 403 | User is banned | User account is banned |
| 403 | User is muted | User account is temporarily muted |
| 403 | Comment thread is locked | Parent comment is locked |
| 404 | Comment not found | Invalid parent_id |
| 503 | Comment system is disabled | System disabled in configuration |

#### Example Request

```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments" \
  -H "Content-Type: application/json" \
  -d '{
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
    "content": "Great episode!"
  }'
```

---

### 2. Edit Comment

**Authentication**: Not required (user_id match only)

#### Request Body

```json
{
  "action": "edit",
  "comment_id": 1,
  "user_info": {
    "user_id": "12345",
    "username": "TestUser",
    "avatar": "https://example.com/avatar.jpg"
  },
  "content": "Updated comment text"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"edit"` |
| `comment_id` | integer | ✅ | ID of comment to edit |
| `user_info` | object | ✅ | User information object |
| `user_info.user_id` | string | ✅ | User's platform ID |
| `user_info.username` | string | ✅ | User's display name |
| `user_info.avatar` | string | ❌ | User's avatar URL |
| `content` | string | ✅ | New comment content |

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "content": "Updated comment text",
    "edited": true,
    "edited_at": "2023-12-01T11:00:00Z",
    "edit_count": 1,
    "edit_history": "[{\"oldContent\":\"Original text\",\"newContent\":\"Updated text\",\"editedAt\":\"2023-12-01T11:00:00Z\",\"editedBy\":\"12345\"}]"
  }
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Comment not found | Invalid comment_id |
| 400 | Cannot edit deleted comment | Comment is already deleted |
| 403 | Comment thread is locked | Comment is locked |
| 403 | You can only edit your own comments | User doesn't own comment |

---

### 3. Delete Comment

**Authentication**: Conditional

- **Own comment**: No authentication required (user_id match only)
- **Others' comment**: Admin verification required

#### Request Body

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

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"delete"` |
| `comment_id` | integer | ✅ | ID of comment to delete |
| `user_info` | object | ✅ | User information object |
| `user_info.user_id` | string | ✅ | User's platform ID |
| `user_info.username` | string | ✅ | User's display name |

#### Authentication Rules

- **Own Comment**: Only `comment_id` and `user_info` required (no admin verification)
- **Others' Comment**: `user_info.user_id` must be in admin/moderator lists

#### Request Examples

**Delete own comment:**
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

**Delete others' comment (admin):**
```json
{
  "action": "delete",
  "comment_id": 1,
  "user_info": {
    "user_id": "67890",
    "username": "AdminUser"
  }
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "deleted": true,
    "deleted_at": "2023-12-01T12:00:00Z",
    "deleted_by": "12345"
  }
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Comment not found | Invalid comment_id |
| 400 | Comment already deleted | Comment is already deleted |
| 401 | Insufficient permissions | Only admins can delete others' comments |

---

## 🗳️ Votes API

### Endpoint: `/votes`

Handles comment voting operations (upvote, downvote, remove).

**Method**: `POST`

**Authentication**: Not required

---

### Vote Operations

#### Request Body

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

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `comment_id` | integer | ✅ | ID of comment to vote on |
| `user_info` | object | ✅ | User information object |
| `user_info.user_id` | string | ✅ | User's platform ID |
| `user_info.username` | string | ✅ | User's display name |
| `vote_type` | string | ✅ | `"upvote"`, `"downvote"`, or `"remove"` |

#### Vote Logic

| Current Vote | New Vote | Result |
|--------------|----------|--------|
| None | upvote | Adds upvote |
| upvote | upvote | Removes upvote |
| downvote | upvote | Changes to upvote |
| None | downvote | Adds downvote |
| downvote | downvote | Removes downvote |
| upvote | downvote | Changes to downvote |
| Any | remove | Removes any existing vote |

#### Response (200 OK)

```json
{
  "success": true,
  "voteScore": 5,
  "upvotes": 6,
  "downvotes": 1,
  "userVote": "upvote"
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid parameters | Missing or invalid parameters |
| 400 | Invalid vote type | Must be upvote, downvote, or remove |
| 403 | Cannot vote on your own comment | Self-voting not allowed |
| 404 | Comment not found | Invalid comment_id |
| 400 | Cannot vote on deleted comment | Comment is deleted |
| 503 | Voting system is disabled | Voting disabled in configuration |

#### Example Request

```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes" \
  -H "Content-Type: application/json" \
  -d '{
    "comment_id": 1,
    "user_info": {
      "user_id": "12345",
      "username": "TestUser"
    },
    "vote_type": "upvote"
  }'
```

---

## 🚨 Reports API

### Endpoint: `/reports`

Handles comment reporting and moderation queue management.

**Method**: `POST`

---

### 1. Create Report

**Authentication**: Not required

#### Request Body

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

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"create"` |
| `comment_id` | integer | ✅ | ID of comment to report |
| `reporter_info` | object | ✅ | Reporter information object |
| `reporter_info.user_id` | string | ✅ | Reporter's user ID |
| `reporter_info.username` | string | ✅ | Reporter's display name |
| `reason` | string | ✅ | Report reason |
| `notes` | string | ❌ | Additional context |

#### Valid Reasons

- `"spam"` - Automated or repetitive content
- `"offensive"` - Offensive language or content
- `"harassment"` - Targeted harassment
- `"spoiler"` - Spoiler content without warning
- `"nsfw"` - Not safe for work content
- `"off_topic"` - Irrelevant to discussion
- `"other"` - Other reasons (specify in notes)

#### Response (201 Created)

```json
{
  "success": true,
  "report": {
    "id": "report-1701427200000-abc123def",
    "reporter_id": "12345",
    "reason": "spam",
    "notes": "This looks like automated spam",
    "created_at": "2023-12-01T10:00:00Z",
    "status": "pending"
  },
  "reportCount": 1
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Invalid reason | Reason not in allowed list |
| 400 | Cannot report your own comment | Self-reporting not allowed |
| 400 | You have already reported this comment | Duplicate report |
| 400 | Cannot report deleted comment | Comment is deleted |
| 503 | Reporting system is disabled | Reporting disabled in configuration |

---

### 2. Resolve Report

**Authentication**: Required (admin only)

#### Request Body

```json
{
  "action": "resolve",
  "comment_id": 1,
  "reporter_info": {
    "user_id": "12345",
    "username": "TestUser"
  },
  "moderator_info": {
    "user_id": "67890",
    "username": "AdminUser"
  },
  "resolution": "resolved",
  "review_notes": "Confirmed spam, removed"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"resolve"` |
| `comment_id` | integer | ✅ | ID of reported comment |
| `reporter_info` | object | ✅ | Original reporter information object |
| `reporter_info.user_id` | string | ✅ | Original reporter's ID |
| `moderator_info` | object | ✅ | Moderator information object |
| `moderator_info.user_id` | string | ✅ | Moderator's user ID |
| `moderator_info.username` | string | ✅ | Moderator's display name |
| `resolution` | string | ✅ | `"resolved"` or `"dismissed"` |
| `review_notes` | string | ❌ | Moderator notes |

#### Response (200 OK)

```json
{
  "success": true,
  "report": {
    "id": "report-1701427200000-abc123def",
    "status": "resolved",
    "reviewed_by": "67890",
    "reviewed_at": "2023-12-01T11:00:00Z",
    "review_notes": "Confirmed spam, removed"
  },
  "commentId": 1,
  "newReportStatus": "resolved"
}
```

---

### 3. Get Reports Queue

**Authentication**: Required (admin only)

#### Request Body

```json
{
  "action": "get_queue",
  "moderator_info": {
    "user_id": "67890",
    "username": "AdminUser"
  }
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"get_queue"` |
| `moderator_info` | object | ✅ | Moderator information object |
| `moderator_info.user_id` | string | ✅ | Moderator's user ID |
| `moderator_info.username` | string | ✅ | Moderator's display name |

#### Response (200 OK)

```json
{
  "reports": [
    {
      "commentId": 1,
      "content": "Spam content here",
      "author": {
        "id": "12345",
        "username": "Spammer",
        "avatar": "https://example.com/avatar.jpg"
      },
      "media": {
        "id": "6789",
        "title": "Attack on Titan",
        "type": "anime",
        "year": 2023
      },
      "createdAt": "2023-12-01T10:00:00Z",
      "reports": [
        {
          "id": "report-1701427200000-abc123def",
          "reporter_id": "54321",
          "reason": "spam",
          "notes": "Obvious spam",
          "created_at": "2023-12-01T10:00:00Z",
          "status": "pending"
        }
      ],
      "totalReports": 1,
      "reportStatus": "pending"
    }
  ],
  "total": 1
}
```

---

## 🔧 Moderation API

### Endpoint: `/moderation`

Handles advanced moderation actions (pin, lock, warn, ban, etc.).

**Method**: `POST`

**Authentication**: Required for all actions (admin only)

---

### Common Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Moderation action |
| `client_type` | string | ✅ | Platform identifier |
| `moderator_id` | string | ✅ | Moderator's user ID |
| `token` | string | ✅ | Moderator's auth token |

---

### 1. Pin Comment

#### Request Body

```json
{
  "action": "pin_comment",
  "comment_id": 1,
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Important announcement"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "pinned": true,
    "pinned_at": "2023-12-01T10:00:00Z",
    "pinned_by": "67890"
  },
  "action": "pinned"
}
```

---

### 2. Lock Thread

#### Request Body

```json
{
  "action": "lock_thread",
  "comment_id": 1,
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Off-topic discussion"
}
```

#### Response (200 OK)

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "locked": true,
    "locked_at": "2023-12-01T10:00:00Z",
    "locked_by": "67890"
  },
  "action": "locked"
}
```

---

### 3. Warn User

#### Request Body

```json
{
  "action": "warn_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Multiple rule violations",
  "severity": "warning",
  "duration": 24
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_user_id` | string | ✅ | User to warn |
| `reason` | string | ✅ | Warning reason |
| `severity` | string | ✅ | `"warning"`, `"mute"`, or `"ban"` |
| `duration` | integer | ❌ | Duration in hours for mutes |

#### Response (200 OK)

```json
{
  "success": true,
  "action": "warning",
  "targetUserId": "12345",
  "reason": "Multiple rule violations",
  "duration": null
}
```

---

### 4. Ban User

#### Request Body

```json
{
  "action": "ban_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Repeated spam",
  "shadow_ban": false
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_user_id` | string | ✅ | User to ban |
| `reason` | string | ✅ | Ban reason |
| `shadow_ban` | boolean | ❌ | `true` for shadow ban, `false` for regular ban |

#### Response (200 OK)

```json
{
  "success": true,
  "action": "banned",
  "targetUserId": "12345",
  "reason": "Repeated spam"
}
```

---

### 5. Get Moderation Queue

#### Request Body

```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token"
}
```

#### Response (200 OK)

```json
{
  "comments": [
    {
      "id": 1,
      "content": "Comment content",
      "reported": true,
      "moderated": true,
      "created_at": "2023-12-01T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

## 📺 Media API

### Endpoint: `/media`

Retrieves comments for specific media with pagination and sorting.

**Method**: `GET`

**Authentication**: Not required

---

### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|----------|-------------|
| `media_id` | string | ✅ | - | Media identifier |
| `client_type` | string | ✅ | - | Platform identifier |
| `page` | integer | ❌ | 1 | Page number |
| `limit` | integer | ❌ | 50 | Results per page |
| `sort` | string | ❌ | newest | Sort order |

### Sort Options

- `newest` - Most recent first
- `oldest` - Oldest first
- `top` - Highest vote score first
- `controversial` - Most upvotes first

### Example Request

```
GET /media?media_id=6789&client_type=anilist&page=1&limit=20&sort=top
```

### Response (200 OK)

```json
{
  "media": {
    "mediaId": "6789",
    "mediaType": "anime",
    "mediaTitle": "Attack on Titan",
    "mediaYear": 2023,
    "mediaPoster": "https://example.com/poster.jpg"
  },
  "comments": [
    {
      "id": 1,
      "content": "Great episode!",
      "username": "User123",
      "user_avatar": "https://example.com/avatar.jpg",
      "user_role": "user",
      "created_at": "2023-12-01T10:00:00Z",
      "upvotes": 10,
      "downvotes": 2,
      "vote_score": 8,
      "pinned": false,
      "locked": false,
      "edited": false,
      "replies": [
        {
          "id": 2,
          "content": "I agree!",
          "username": "User456",
          "created_at": "2023-12-01T10:30:00Z",
          "upvotes": 3,
          "downvotes": 0,
          "vote_score": 3,
          "replies": []
        }
      ]
    }
  ],
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

## 👤 Users API

### Endpoint: `/users`

Handles user role management and queries.

**Method**: `POST`

---

### Get User Role

#### Request Body

```json
{
  "action": "get_role",
  "client_type": "anilist",
  "user_id": "12345",
  "token": "user_auth_token"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | ✅ | Must be `"get_role"` |
| `client_type` | string | ✅ | Platform identifier |
| `user_id` | string | ✅ | User's platform ID |
| `token` | string | ❌ | Optional token for verification |

#### Response (200 OK)

```json
{
  "success": true,
  "role": "user",
  "user_id": "12345",
  "client_type": "anilist"
}
```

#### Possible Roles

- `"user"` - Regular user
- `"moderator"` - Can moderate comments
- `"admin"` - Can ban/unban users
- `"super_admin"` - Full system access

---

## 🤖 Discord API

### Endpoint: `/discord`

Discord bot integration for real-time moderation.

**Authentication**: Discord bot signature verification

📖 **Full Documentation**: [Discord Setup Guide](./DISCORD_SETUP.md)

---

## ❌ Error Handling

### Standard Error Response

```json
{
  "error": "Error description"
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (for new resources) |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (authentication required/failed) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (system disabled) |

### Error Response Examples

**Missing parameters:**
```json
{
  "error": "client_type, user_id, media_id, and content are required for create action"
}
```

**Authentication failed:**
```json
{
  "error": "Invalid token or user_id does not match"
}
```

**Insufficient permissions:**
```json
{
  "error": "Only admins and super admins can delete other users comments"
}
```

---

## ⚡ Rate Limiting

### Default Rate Limits

| Action | Limit | Per |
|---------|-------|-----|
| Comments | 30 | hour/user |
| Votes | 100 | hour/user |
| Reports | 10 | hour/user |

### Rate Limit Response

When rate limited:

```json
{
  "error": "Rate limit exceeded"
}
```

HTTP Status: `429 Too Many Requests`

---

## 🌐 CORS Headers

All endpoints include CORS headers for cross-origin requests:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: content-type
```

---

## 🧪 Testing

### Live Testing Environment

**Base URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

### Quick Test Examples

```bash
# Test creating a comment (no auth needed)
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "Test comment from API docs"
  }'

# Test getting media comments (no auth needed)
curl "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=6789&client_type=anilist&limit=5"

# Test voting (no auth needed)
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes" \
  -H "Content-Type: application/json" \
  -d '{
    "comment_id": 1,
    "user_id": "12345",
    "vote_type": "upvote"
  }'
```

---

## 📚 Additional Documentation

- 📖 **[Quick Start Guide](./QUICK_START.md)** - 5-minute integration guide
- 📖 **[Database Schema](./DATABASE_SCHEMA.md)** - Database structure reference
- 📖 **[Discord Setup](./DISCORD_SETUP.md)** - Discord bot integration
- 📖 **[Deployment Guide](./DEPLOYMENT.md)** - Deploy your own instance
- 📖 **[API Documentation](./API.md)** - Original API documentation

---

## 🎯 Integration Checklist

When integrating Commentum v2:

- ✅ Choose your `client_type` (anilist, myanimelist, simkl, other)
- ✅ Implement comment creation
- ✅ Implement comment display
- ✅ Add voting functionality
- ✅ Implement nested replies
- ✅ Add error handling
- ✅ Handle rate limits
- ✅ Optional: Add reporting UI
- ✅ Optional: Add admin dashboard
- ✅ Optional: Configure Discord bot

---

## 🚀 Ready to Integrate?

This backend service is ready for your app to consume:

- ✅ Simple REST API
- ✅ No API keys required
- ✅ Open system design
- ✅ Multi-platform support
- ✅ Comprehensive features

**Start integrating today!** 🚀
