# 🚀 Quick Start Guide - Commentum v2

**Project URL**: `https://whzwmfxngelicmjyxwmr.supabase.co`  
**Base API URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

## 🎯 5-Minute Integration

### ✅ What You Need to Know

- **🔑 NO API KEYS REQUIRED** - Zero authentication setup
- **🚀 Open System** - Anyone can comment and vote
- **📱 Multi-Platform** - Supports AniList, MyAnimeList, SIMKL
- **⚡ Real-time** - Voting, reporting, moderation

### 🎬 Basic Usage

#### 1. Create a Comment
```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "Great episode!"
  }'
```

#### 2. Get Comments for Media
```bash
curl "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=6789&client_type=anilist&limit=20"
```

#### 3. Vote on Comment
```bash
curl -X POST "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes" \
  -H "Content-Type: application/json" \
  -d '{
    "comment_id": 1,
    "user_id": "12345",
    "vote_type": "upvote"
  }'
```

### 📊 Response Format

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "content": "Great episode!",
    "username": "UserName",
    "user_avatar": "https://example.com/avatar.jpg",
    "created_at": "2023-12-01T10:00:00Z",
    "upvotes": 10,
    "downvotes": 2,
    "vote_score": 8,
    "replies": []
  }
}
```

### 🔐 Authentication (When Needed)

Only required for:
- ✏️ Editing your own comments
- 🗑️ Deleting comments (admin for others)
- 👮‍♂️ Admin actions (ban, pin, lock)

```json
{
  "client_type": "anilist",
  "user_id": "12345", 
  "token": "platform_auth_token"
}
```

### 🎮 JavaScript Example

```javascript
// Create a comment
async function createComment(mediaId, content) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      client_type: 'anilist',
      user_id: '12345',
      media_id: mediaId,
      content: content
    })
  });
  return await response.json();
}

// Get comments for media
async function getComments(mediaId, page = 1) {
  const response = await fetch(
    `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=${mediaId}&client_type=anilist&page=${page}`
  );
  return await response.json();
}

// Vote on comment
async function voteOnComment(commentId, voteType) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comment_id: commentId,
      user_id: '12345',
      vote_type: voteType // 'upvote', 'downvote', 'remove'
    })
  });
  return await response.json();
}

// Delete own comment (no auth needed)
async function deleteComment(commentId) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'delete',
      comment_id: commentId,
      user_id: '12345'
    })
  });
  return await response.json();
}

// Delete any comment (admin only)
async function deleteCommentAsAdmin(commentId, token) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'delete',
      comment_id: commentId,
      user_id: '67890',  // Admin user ID
      client_type: 'anilist',
      token: token  // Admin auth token
    })
  });
  return await response.json();
}
```

### 🛠️ Full API Reference

**📖 Complete Documentation**: [COMPLETE_API_REFERENCE.md](./COMPLETE_API_REFERENCE.md)

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `/comments` | Create, edit, delete | Edit/delete only |
| `/votes` | Upvote/downvote | ❌ No |
| `/media` | Get comments | ❌ No |
| `/reports` | Report content | Admin for resolution |
| `/moderation` | Admin actions | ✅ Yes |
| `/discord` | Discord bot | ✅ Yes |

### 🎯 Platform Support

| Platform | User ID Format | Token Type |
|----------|---------------|------------|
| **AniList** | Numeric ID | Bearer Token |
| **MyAnimeList** | Numeric ID | Bearer Token |
| **SIMKL** | Username/ID | API Key |
| **Other** | Custom | Custom |

### ⚡ Rate Limits

- **Comments**: 30 per hour per user
- **Votes**: 100 per hour per user  
- **Reports**: 10 per hour per user

### 🚨 Error Handling

```json
{
  "error": "Error description"
}
```

Common HTTP codes:
- `200` - Success
- `400` - Bad request
- `403` - Forbidden
- `404` - Not found
- `429` - Rate limited
- `503` - System disabled

### 🔧 Configuration

System settings are stored in the database `config` table:
- `max_comment_length`: 10000 characters
- `max_nesting_level`: 10 reply depth
- `system_enabled`: true/false
- `voting_enabled`: true/false

### 🎉 Ready to Go!

That's it! You now have a fully functional comment system with:
- ✅ Real-time voting
- ✅ Nested replies
- ✅ Content moderation
- ✅ User reporting
- ✅ Discord integration
- ✅ Rate limiting
- ✅ Multi-platform support

**No setup required** - start integrating immediately! 🚀