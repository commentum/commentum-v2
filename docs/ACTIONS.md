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

## 📢 Announcements API

### List Announcements
- **Endpoint**: `GET /announcements`
- **Auth**: none
- **Role**: -
- **Query**: `app_id` (required), `status`, `category`, `page`, `limit`, `user_id`

### Get Announcement
- **Endpoint**: `GET /announcements/:id`
- **Auth**: none
- **Role**: -

### Get Unread Count
- **Endpoint**: `GET /announcements/unread-count`
- **Auth**: none
- **Role**: -
- **Query**: `user_id` (required), `app_id` (required)

### Mark Viewed
- **Endpoint**: `POST /announcements/:id/view`
- **Auth**: none
- **Role**: -

### Mark Read
- **Endpoint**: `POST /announcements/:id/read`
- **Auth**: none
- **Role**: -
- **Body**: `user_id` (required), `app_id` (required)

### Create Announcement
- **Endpoint**: `POST /announcements`
- **Auth**: ✅ token required
- **Role**: super_admin+ (owner or super_admin)
- **Body**: `app_id`, `title`, `short_description`, `full_content`, `category`, `priority`, `pinned`, `publish`

### Update Announcement
- **Endpoint**: `PATCH /announcements/:id`
- **Auth**: ✅ token required
- **Role**: super_admin+

### Delete Announcement
- **Endpoint**: `DELETE /announcements/:id`
- **Auth**: ✅ token required
- **Role**: super_admin+

### Publish Announcement
- **Endpoint**: `POST /announcements/:id/publish`
- **Auth**: ✅ token required
- **Role**: super_admin+
- **Note**: Sends Discord notification on publish

### Archive Announcement
- **Endpoint**: `POST /announcements/:id/archive`
- **Auth**: ✅ token required
- **Role**: super_admin+

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

## 📊 Role Hierarchy

| Role | Level | Display As | Description |
|------|-------|------------|-------------|
| owner | 4 | super_admin | System owner (hidden for security) |
| super_admin | 3 | super_admin | Full system access |
| admin | 2 | admin | Administrative access |
| moderator | 1 | moderator | Moderation powers |
| user | 0 | user | Regular user |

**Security Note**: The `owner` role is the highest privilege level but is displayed as `super_admin` in all API responses to hide its existence.
