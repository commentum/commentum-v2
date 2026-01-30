# 🚀 Quick Start Guide - Commentum v2 Backend API

**🎯 IMPORTANT**: Commentum v2 is a **backend API service** for apps to integrate with. This is NOT a standalone application.

**This guide shows you how to integrate Commentum v2 into your app.**

---

## 📋 What You Need

- **Your app**: An application that needs comment functionality
- **Your users**: Users who will create and read comments
- **A few minutes**: That's it!

**NO API KEYS REQUIRED** - Zero authentication setup needed for basic usage.

---

## 🎯 The Concept

### How Integration Works

```
┌─────────────────┐      HTTP API       ┌───────────────────┐
│                 │ ◄─────────────────► │                   │
│   Your App      │                     │   Commentum v2    │
│   (Frontend)    │                     │ (Backend Service) │
│                 │                     │                   │
└─────────────────┘                     └───────────────────┘
        │                                     │
        │                                     │
        │ Displays                            │ Stores &
        │ Comments                            │ Moderates
        ▼                                     ▼
     Your Users                         PostgreSQL DB
```

**You build the frontend**, **Commentum v2 handles the backend.**

### What You Do

1. Make HTTP requests to Commentum v2 endpoints
2. Display responses to your users
3. That's it!

### What Commentum v2 Does

1. Stores and retrieves comments
2. Handles voting and moderation
3. Manages user reports
4. Sends Discord notifications (optional)
5. Enforces rate limiting and security

---

## 🌐 Live Example

**Base URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

You can test the API right now:

```bash
# Create a comment
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
    "content": "Test comment from API docs"
  }'

# Get comments
curl "https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=6789&client_type=anilist&limit=5"
```

---

## 💻 Integration Examples

### 1. JavaScript (Vanilla)

```javascript
// Create a comment
async function createComment(userId, mediaId, content, user = {}) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      client_type: 'anilist',
      user_info: {
        user_id: userId,
        username: user.username || 'Anonymous',
        avatar: user.avatar
      },
      media_info: {
        media_id: mediaId,
        type: 'anime',
        title: 'Media Title',
        year: 2023,
        poster: 'https://example.com/poster.jpg'
      },
      content: content
    })
  });

  const data = await response.json();
  console.log('Comment created:', data.comment);
  return data;
}

// Get comments for media
async function getComments(mediaId, clientType = 'anilist', page = 1) {
  const response = await fetch(
    `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=${mediaId}&client_type=${clientType}&page=${page}&limit=20`
  );
  const data = await response.json();
  return data.comments;
}

// Vote on comment
async function voteOnComment(commentId, userId, voteType, user = {}) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comment_id: commentId,
      user_info: {
        user_id: userId,
        username: user.username || 'Anonymous'
      },
      vote_type: voteType // 'upvote', 'downvote', 'remove'
    })
  });

  const data = await response.json();
  return data;
}

// Delete own comment (no auth needed)
async function deleteComment(commentId, userId, user = {}) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'delete',
      comment_id: commentId,
      user_info: {
        user_id: userId,
        username: user.username || 'Anonymous'
      }
    })
  });

  const data = await response.json();
  return data;
}
```

### 2. React Hook

```javascript
import { useState, useEffect } from 'react';

function useComments(mediaId, clientType = 'anilist') {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchComments() {
      setLoading(true);
      const response = await fetch(
        `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=${mediaId}&client_type=${clientType}&limit=50`
      );
      const data = await response.json();
      setComments(data.comments);
      setLoading(false);
    }

    fetchComments();
  }, [mediaId, clientType]);

  const createComment = async (content, currentUser) => {
    const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        client_type: clientType,
        user_info: {
          user_id: currentUser.id,
          username: currentUser.username,
          avatar: currentUser.avatar
        },
        media_info: {
          media_id: mediaId,
          type: 'anime',
          title: 'Media Title',
          year: 2023,
          poster: 'https://example.com/poster.jpg'
        },
        content: content
      })
    });

    const data = await response.json();
    setComments(prev => [data.comment, ...prev]);
    return data;
  };

  return { comments, loading, createComment };
}

// Usage in component
function CommentSection({ mediaId, currentUser }) {
  const { comments, loading, createComment } = useComments(mediaId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const content = e.target.content.value;
    await createComment(content, currentUser);
    e.target.content.value = '';
  };

  if (loading) return <div>Loading comments...</div>;

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea name="content" />
        <button type="submit">Post Comment</button>
      </form>
      {comments.map(comment => (
        <CommentCard key={comment.id} comment={comment} />
      ))}
    </div>
  );
}
```

### 3. Vue.js Component

```javascript
<template>
  <div>
    <form @submit.prevent="submitComment">
      <textarea v-model="newComment" />
      <button type="submit">Post Comment</button>
    </form>
    <div v-if="loading">Loading...</div>
    <div v-for="comment in comments" :key="comment.id">
      <CommentCard :comment="comment" />
    </div>
  </div>
</template>

<script>
export default {
  props: ['mediaId', 'currentUser'],
  data() {
    return {
      comments: [],
      loading: true,
      newComment: ''
    };
  },
  async mounted() {
    await this.loadComments();
  },
  methods: {
    async loadComments() {
      const response = await fetch(
        `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=${this.mediaId}&client_type=anilist`
      );
      const data = await response.json();
      this.comments = data.comments;
      this.loading = false;
    },
    async submitComment() {
      await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          client_type: 'anilist',
          user_info: {
            user_id: this.currentUser.id,
            username: this.currentUser.username,
            avatar: this.currentUser.avatar
          },
          media_info: {
            media_id: this.mediaId,
            type: 'anime',
            title: 'Media Title',
            year: 2023,
            poster: 'https://example.com/poster.jpg'
          },
          content: this.newComment
        })
      });
      await this.loadComments();
      this.newComment = '';
    }
  }
};
</script>
```

---

## 📊 Response Format

### Create Comment Response

```json
{
  "success": true,
  "comment": {
    "id": 1,
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "Great episode!",
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
    "replies": []
  }
}
```

### Get Comments Response

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
      "username": "UserName",
      "user_avatar": "https://example.com/avatar.jpg",
      "created_at": "2023-12-01T10:00:00Z",
      "upvotes": 10,
      "downvotes": 2,
      "vote_score": 8,
      "pinned": false,
      "locked": false,
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

## 🔧 API Endpoints Quick Reference

| Endpoint | Method | Purpose | Auth |
|----------|---------|---------|-------|
| `/comments` | POST | Create comment | ❌ No |
| `/comments` | POST | Edit comment | ✅ Token |
| `/comments` | POST | Delete comment | Owner: ❌, Others: ✅ |
| `/votes` | POST | Vote on comment | ❌ No |
| `/media` | GET | Get comments | ❌ No |
| `/reports` | POST | Report comment | ❌ No |
| `/reports` | POST | Resolve report | ✅ Admin |
| `/moderation` | POST | Moderation actions | ✅ Admin |

**Full API Reference**: [COMPLETE_API_REFERENCE.md](./COMPLETE_API_REFERENCE.md)

---

## 🎮 Platform Support

### Supported Platforms

| Platform | client_type | Token Type | User ID Format |
|----------|--------------|-------------|----------------|
| AniList | `anilist` | Bearer Token | Numeric ID |
| MyAnimeList | `myanimelist` | Bearer Token | Numeric ID |
| SIMKL | `simkl` | API Key | Username/ID |
| Custom | `other` | Custom | Custom |

### Platform Authentication

Only required for:
- ✏️ Editing own comments
- 👮 Admin/moderation actions

```json
{
  "client_type": "anilist",
  "user_id": "12345",
  "token": "platform_auth_token"
}
```

---

## 🔐 When Authentication Is Required

### NO Authentication Required

- ✅ Creating comments
- ✅ Reading comments
- ✅ Voting
- ✅ Deleting own comments (user_id match)
- ✅ Reporting content
- ✅ Getting user roles

### Authentication Required

- 🔑 Editing own comments (user_id match only)
- 🔑 Admin moderation actions (role verification only)
- 🔑 Report resolution (admin only)

---

## ⚡ Rate Limits

Default rate limits (configurable in database):

- **Comments**: 30 per hour per user
- **Votes**: 100 per hour per user
- **Reports**: 10 per hour per user

When rate limited: Returns `429 Too Many Requests`

---

## 🚨 Error Handling

### Standard Error Response

```json
{
  "error": "Error description"
}
```

### Common HTTP Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (invalid parameters) |
| 401 | Unauthorized (authentication failed) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Internal Server Error |
| 503 | Service Unavailable (system disabled) |

---

## 🎨 Displaying Comments

### Simple Comment Card Example

```javascript
function CommentCard({ comment, currentUser, onVote, onDelete }) {
  return (
    <div className="comment-card">
      <div className="comment-header">
        <img src={comment.user_avatar} alt={comment.username} />
        <span className="username">{comment.username}</span>
        <span className="timestamp">
          {new Date(comment.created_at).toLocaleString()}
        </span>
      </div>

      <div className="comment-content">
        {comment.edited && <span className="edited-badge">(edited)</span>}
        {comment.content}
      </div>

      <div className="comment-actions">
        <button onClick={() => onVote(comment.id, 'upvote')}>
          👍 {comment.upvotes}
        </button>
        <button onClick={() => onVote(comment.id, 'downvote')}>
          👎 {comment.downvotes}
        </button>

        {comment.user_id === currentUser?.id && (
          <button onClick={() => onDelete(comment.id)}>
            🗑️ Delete
          </button>
        )}

        {comment.pinned && <span className="pinned-badge">📌 Pinned</span>}
      </div>

      {/* Render nested replies */}
      {comment.replies?.map(reply => (
        <CommentCard
          key={reply.id}
          comment={reply}
          currentUser={currentUser}
          onVote={onVote}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

---

## 🚀 Advanced Usage

### Edit Comment (User ID Match Only)

```javascript
async function editComment(commentId, userId, newContent, user = {}) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'edit',
      comment_id: commentId,
      user_info: {
        user_id: userId,
        username: user.username || 'Anonymous',
        avatar: user.avatar
      },
      content: newContent
    })
  });

  return await response.json();
}
```

### Report Comment

```javascript
async function reportComment(commentId, reporterId, reason, notes, reporter = {}) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      comment_id: commentId,
      reporter_info: {
        user_id: reporterId,
        username: reporter.username || 'Anonymous'
      },
      reason: reason,  // 'spam', 'offensive', 'harassment', etc.
      notes: notes
    })
  });

  return await response.json();
}
```

### Moderation (Admin Only)

```javascript
async function pinComment(commentId, moderatorId, reason, moderator = {}) {
  const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/moderation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'pin_comment',
      comment_id: commentId,
      moderator_info: {
        user_id: moderatorId,
        username: moderator.username || 'Moderator'
      },
      reason: reason
    })
  });

  return await response.json();
}
```

---

## 🎯 Next Steps

### For App Developers

1. ✅ Integrate basic commenting (use examples above)
2. ✅ Add voting functionality
3. ✅ Implement nested replies display
4. ✅ Add reporting UI (optional)
5. ✅ Create admin dashboard (optional)

### For Backend Developers

1. ✅ Deploy your own Commentum v2 instance
2. ✅ Configure platform API keys
3. ✅ Set up moderators/admins
4. ✅ Configure rate limits
5. ✅ Set up Discord bot (optional)

---

## 📚 Additional Documentation

- 📖 **[Complete API Reference](./COMPLETE_API_REFERENCE.md)** - All endpoints detailed
- 📖 **[Database Schema](./DATABASE_SCHEMA.md)** - Database structure
- 📖 **[Deployment Guide](./DEPLOYMENT.md)** - Deploy your own instance
- 📖 **[Discord Setup](./DISCORD_SETUP.md)** - Discord bot integration

---

## 🎉 You're Ready!

You now have everything you need to integrate Commentum v2 into your app:

- ✅ Backend API endpoints
- ✅ Example code
- ✅ Response formats
- ✅ Error handling
- ✅ Rate limiting info

**Start integrating and add comment functionality to your app in minutes!** 🚀

**Remember**: Commentum v2 handles the backend, you handle the frontend UI. Simple as that!
