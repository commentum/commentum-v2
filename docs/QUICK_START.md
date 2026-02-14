# 🚀 Quick Start Guide - Commentum v2 Backend API

**🎯 IMPORTANT**: Commentum v2 is a **backend API service** for apps to integrate with.

---

## 🔐 Authentication Methods

### Basic Actions (user_info only)
```json
{
  "user_info": {
    "user_id": "12345",
    "username": "TestUser",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

### Mod+ Actions (token required)
```json
{
  "client_type": "anilist",
  "access_token": "user_oauth_token_from_provider"
}
```

---

## 💻 Code Examples

### Create Comment
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/comments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    client_type: 'anilist',
    user_info: {
      user_id: '12345',
      username: 'TestUser'
    },
    media_info: {
      media_id: '6789',
      type: 'anime',
      title: 'Attack on Titan'
    },
    content: 'Great episode!'
  })
});
```

### Get Comments
```javascript
const response = await fetch(
  'https://your-project.supabase.co/functions/v1/media?media_id=6789&client_type=anilist'
);
```

### Vote
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/votes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    comment_id: 1,
    user_info: { user_id: '12345', username: 'TestUser' },
    vote_type: 'upvote'
  })
});
```

### Delete Own Comment
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/comments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'delete',
    comment_id: 1,
    user_info: { user_id: '12345', username: 'TestUser' }
  })
});
```

---

## 🛡️ Moderation (Token Required)

### Pin Comment
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/moderation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'pin_comment',
    comment_id: 1,
    client_type: 'anilist',
    access_token: 'user_oauth_token',
    reason: 'Important information'
  })
});
```

### Ban User (Admin+)
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/moderation', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'ban_user',
    target_user_id: '12345',
    client_type: 'anilist',
    access_token: 'admin_oauth_token',
    reason: 'Repeated violations',
    shadow_ban: false
  })
});
```

### Mod Delete Other's Comment
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/comments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'mod_delete',
    comment_id: 1,
    client_type: 'anilist',
    access_token: 'mod_oauth_token'
  })
});
```

---

## 📊 Auth Requirements

| Action | Auth | Min Role |
|--------|------|----------|
| Create comment | user_info | user |
| Edit comment | user_info (owner) | user |
| Delete own comment | user_info (owner) | user |
| Vote | user_info | user |
| Report | user_info | user |
| Get comments | none | - |
| Mod delete | token | moderator |
| Pin/Lock | token | moderator |
| Warn | token | moderator |
| Ban | token | admin |

---

## 📚 Full Docs

- [Complete API Reference](./COMPLETE_API_REFERENCE.md)
- [Actions Reference](./ACTIONS.md)
- [Database Schema](./DATABASE_SCHEMA.md)

---

## 📢 Announcements API

### Get Announcements (Public)
```javascript
const response = await fetch(
  'https://your-project.supabase.co/functions/v1/announcements?app_id=anymex&status=published'
);
```

### Create Announcement (Super Admin+)
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/announcements', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_type: 'anilist',
    access_token: 'super_admin_oauth_token',
    app_id: 'anymex',
    title: 'New Feature Release',
    short_description: 'We have added a new feature...',
    full_content: '# Details\n\nFull markdown content here...',
    category: 'feature',
    publish: true
  })
});
```

### Mark as Read
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/announcements/1/read', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user_id: '12345',
    app_id: 'anymex'
  })
});
```
