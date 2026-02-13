# System Actions and Capabilities - Commentum v2

Complete reference of all available actions and their authentication requirements.

---

## 🔐 Authentication Methods

### Token-Based Authentication (Mod+ Actions)

All moderation and admin actions use **token-based authentication**:

```json
{
  "client_type": "anilist",
  "access_token": "user_oauth_token_from_provider"
}
```

Verified with provider APIs:
- **AniList**: GraphQL API
- **MAL**: REST API  
- **SIMKL**: REST API

### User Info (Basic Actions)

```json
{
  "user_info": {
    "user_id": "12345",
    "username": "TestUser",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

---

## 📝 Comments API

### Create Comment
- **Endpoint**: `POST /comments`
- **Auth**: user_info
- **Role**: user

### Edit Comment
- **Endpoint**: `POST /comments`
- **Auth**: user_info (owner only)
- **Role**: user

### Delete Comment (Own)
- **Endpoint**: `POST /comments`
- **Auth**: user_info (owner only)
- **Role**: user

### Mod Delete Comment
- **Endpoint**: `POST /comments`
- **Auth**: ✅ token required
- **Role**: moderator+

---

## 🗳️ Votes API

### Vote
- **Endpoint**: `POST /votes`
- **Auth**: user_info
- **Role**: user
- **Types**: `upvote`, `downvote`, `remove`

---

## 🚨 Reports API

### Create Report
- **Endpoint**: `POST /reports`
- **Auth**: user_info
- **Role**: user
- **Reasons**: `spam`, `offensive`, `harassment`, `spoiler`, `nsfw`, `off_topic`, `other`

### Resolve Report
- **Endpoint**: `POST /reports`
- **Auth**: ✅ token required
- **Role**: moderator+

### Get Reports Queue
- **Endpoint**: `POST /reports`
- **Auth**: ✅ token required
- **Role**: moderator+

---

## 🔧 Moderation API

### Endpoint: `POST /moderation`
**All actions require token auth**

| Action | Role | Description |
|--------|------|-------------|
| `pin_comment` | moderator | Pin a comment |
| `unpin_comment` | moderator | Unpin a comment |
| `lock_thread` | moderator | Lock a thread |
| `unlock_thread` | moderator | Unlock a thread |
| `warn_user` | moderator | Warn a user |
| `ban_user` | admin | Ban a user |
| `unban_user` | admin | Unban a user |
| `get_queue` | moderator | Get moderation queue |

---

## 👤 Users API

### Endpoint: `POST /users`
**All actions require token auth**

| Action | Role | Description |
|--------|------|-------------|
| `get_user_info` | moderator | Get user information |
| `get_user_stats` | moderator | Get user statistics |
| `warn_user` | moderator | Warn a user |
| `mute_user` | moderator | Mute a user |
| `unmute_user` | moderator | Unmute a user |
| `ban_user` | admin | Ban a user |
| `unban_user` | admin | Unban a user |
| `get_user_history` | moderator | Get user history |

---

## 📺 Media API

### Get Comments
- **Endpoint**: `GET /media`
- **Auth**: none
- **Role**: -

---

## 🎯 Action Matrix

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
| mute_user | /users | token | moderator |
| ban_user | /users | token | admin |
| unban_user | /users | token | admin |
| get_media | /media | none | - |
