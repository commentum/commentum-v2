# System Actions & Capabilities — Commentum v2

Complete reference of all available endpoints, supported actions, and their authentication requirements in Commentum v2.

---

## 🔐 Authentication Architecture

Commentum v2 uses a **stateless Session Token (HMAC-SHA256 JWT)** model designed for low latency (<1ms token verification) and complete anti-spoofing guarantees.

### 1. Exchange Provider Token for Commentum JWT
Client logs in once with their provider OAuth token (AniList, MyAnimeList, or SIMKL):
```http
POST /auth/login
Content-Type: application/json

{
  "provider": "anilist",
  "token": "user_oauth_token"
}
```

Response:
```json
{
  "success": true,
  "session_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 604800,
  "user": {
    "uid": "123456",
    "username": "Sheby",
    "provider": "anilist",
    "role": "owner",
    "avatar": "https://s4.anilist.co/user/avatar/medium/...",
    "points": 1450,
    "streak": 12
  }
}
```

### 2. Authenticated Requests
All subsequent requests supply the token in the standard HTTP header:
```http
Authorization: Bearer <session_token>
```
*(Also accepts `x-session-token` header).*

---

## 📝 Comments & Threads API

### Post Comment
- **Endpoint**: `POST /comments`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `user`
- **Body**:
  ```json
  {
    "action": "create",
    "media_id": "16498",
    "media_type": "anime",
    "media_title": "Attack on Titan",
    "content": "This episode was incredible!",
    "parent_id": null
  }
  ```

### Edit Comment
- **Endpoint**: `POST /comments`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `user` (Comment author only)
- **Body**:
  ```json
  {
    "action": "edit",
    "comment_id": 1042,
    "content": "Updated thoughts on this scene..."
  }
  ```

### Delete Own Comment
- **Endpoint**: `POST /comments`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `user` (Comment author only)
- **Body**:
  ```json
  {
    "action": "delete",
    "comment_id": 1042
  }
  ```

### Moderator Delete Comment
- **Endpoint**: `POST /comments`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `moderator+`
- **Body**:
  ```json
  {
    "action": "delete",
    "comment_id": 1042,
    "reason": "Violated community spoiler rules"
  }
  ```

---

## 📺 Media API

### Get Comments for Media
- **Endpoint**: `GET /media`
- **Auth**: ✅ Bearer JWT (Required)
- **Query Parameters**:
  - `media_id` (required): Media identifier (e.g., `16498`)
  - `client_type` (optional): Default inferred from user token
  - `page` (optional): Page number (default: `1`)
  - `limit` (optional): Items per page (default: `30`, max: `100`)
  - `sort` (optional): `best` | `newest` | `oldest` (default: `best`)
- **Response**: Returns threaded comment tree with pinned comments at top and personal `user_vote` injected automatically.

---

## 🗳️ Votes API

### Cast or Toggle Vote
- **Endpoint**: `POST /votes`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `user`
- **Body**:
  ```json
  {
    "comment_id": 1042,
    "vote_type": 1
  }
  ```
  *(Accepts numeric `1`, `-1`, `0` or string `'upvote'`, `'downvote'`, `'remove'`)*

---

## 🚨 Reports API

### File Report
- **Endpoint**: `POST /reports`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `user`
- **Body**:
  ```json
  {
    "action": "report",
    "comment_id": 1042,
    "reason": "spoiler",
    "notes": "Untagged manga ending spoilers"
  }
  ```

### Resolve / Dismiss Report
- **Endpoint**: `POST /reports`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `moderator+`
- **Body**:
  ```json
  {
    "action": "resolve",
    "comment_id": 1042,
    "reporter_id": "78910",
    "resolution": "resolved",
    "notes": "Comment removed"
  }
  ```

### View Reports Queue
- **Endpoint**: `POST /reports`
- **Auth**: ✅ Bearer JWT (Required)
- **Role**: `moderator+`
- **Body**:
  ```json
  {
    "action": "get_queue",
    "page": 1,
    "limit": 20
  }
  ```

---

## 🛡️ Moderation API

All moderation actions verify staff credentials directly from the verified Bearer JWT claims.

### Endpoint: `POST /moderation`
| Action | Min Role | Description |
|---|---|---|
| `pin_comment` | `moderator` | Pin comment to top of media discussion |
| `unpin_comment` | `moderator` | Unpin comment |
| `lock_thread` | `moderator` | Lock comment thread to prevent replies |
| `unlock_thread` | `moderator` | Unlock comment thread |
| `warn_user` | `moderator` | Issue formal warning to user |
| `mute_user` | `moderator` | Temporarily mute user from commenting |
| `unmute_user` | `moderator` | Lift user mute |
| `ban_user` | `admin` | Ban user |
| `unban_user` | `admin` | Unban user |
| `get_queue` | `moderator` | List reported comments pending review |

---

## 🔔 Notifications API

### Register FCM Token
- **Endpoint**: `POST /notifications`
- **Auth**: ✅ Bearer JWT (Required)
- **Body**:
  ```json
  {
    "action": "register_token",
    "fcm_token": "fcm_device_token_here",
    "platform": "android",
    "app_version": "3.5.0"
  }
  ```

### Get Notification History
- **Endpoint**: `GET /notifications?action=get_history&page=1&limit=30` (or `POST /notifications`)
- **Auth**: ✅ Bearer JWT (Required)

### Mark Notification as Read
- **Endpoint**: `POST /notifications`
- **Auth**: ✅ Bearer JWT (Required)
- **Body**:
  ```json
  {
    "action": "mark_read",
    "notification_id": 451
  }
  ```

### Mark All as Read
- **Endpoint**: `POST /notifications`
- **Auth**: ✅ Bearer JWT (Required)
- **Body**:
  ```json
  {
    "action": "mark_all_read"
  }
  ```

### Get Unread Notification Count
- **Endpoint**: `GET /notifications?action=get_unread_count` (or `POST /notifications`)
- **Auth**: ✅ Bearer JWT (Required)

---

## 🏆 Points, Streaks & Shop API

### Get Points & Streak Status
- **Endpoint**: `GET /points` (or `POST /points` `{ "action": "get_points" }`)
- **Auth**: ✅ Bearer JWT (Required)

### Get Points Leaderboard
- **Endpoint**: `GET /points?action=get_leaderboard&limit=50`
- **Auth**: ✅ Bearer JWT (Required)

### Unlock Customization Item
- **Endpoint**: `POST /users`
- **Auth**: ✅ Bearer JWT (Required)
- **Body**:
  ```json
  {
    "action": "unlock_customization",
    "customization_id": "neon_cyber_badge"
  }
  ```

### Update Active Profile Customizations
- **Endpoint**: `POST /users`
- **Auth**: ✅ Bearer JWT (Required)
- **Body**:
  ```json
  {
    "action": "update_customizations",
    "avatar_decoration": "neon_frame_01",
    "banner_url": "https://cdn.example.com/banner.gif",
    "nameplate_theme": "cyberpunk_glow"
  }
  ```

### Export My Data (GDPR / Portability)
- **Endpoint**: `POST /users`
- **Auth**: ✅ Bearer JWT (Required)
- **Body**:
  ```json
  {
    "action": "export_my_data"
  }
  ```

---

## 📢 Announcements API

### Public Announcements Feed
- **Endpoint**: `GET /announcements`
- **Auth**: Optional / Authenticated for automatic unread status
- **Query**: `app_id=anymex&status=published&page=1&limit=20`

### Admin Create / Publish Announcement
- **Endpoint**: `POST /announcements`
- **Auth**: ✅ Bearer JWT (`super_admin` or `owner`)

---

## 📊 Role Hierarchy Matrix

| Role Level | Role Identifier | Displayed As | Capabilities |
|---|---|---|---|
| 5 | `owner` | `super_admin` | Full cluster ownership, backup export, staff promotions |
| 4 | `app_owner` | `super_admin` | Dedicated app owner, system configuration |
| 3 | `super_admin` | `super_admin` | Global announcements, system config, staff controls |
| 2 | `admin` | `admin` | Ban/unban users, delete comments, manage roles |
| 1 | `moderator` | `moderator` | Pin/unpin, lock/unlock, warn/mute users, resolve reports |
| 0 | `user` | `user` | Post comments, replies, votes, unlock shop items, notifications |
