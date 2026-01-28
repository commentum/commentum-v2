# Commentum v2 Documentation

**🎯 IMPORTANT: Commentum v2 is a BACKEND API SERVICE for apps to integrate with. This is NOT a standalone application.**

---

## 📚 Documentation Overview

Commentum v2 provides a comprehensive comment system backend that apps can integrate via REST API. All documentation assumes you're integrating this backend into your application.

```
┌─────────────┐      API Calls       ┌──────────────┐
│   Your App  │ ◄─────────────────► │ Commentum v2  │
│ (Frontend)  │                       │ (Backend API)  │
└─────────────┘                       └──────────────┘
```

---

## 🚀 Quick Start

### New to Commentum v2?

Start here to get up and running quickly:

1. **[Quick Start Guide](./QUICK_START.md)** ⏱️ 5 minutes
   - How to integrate the API
   - Basic code examples
   - Response formats

2. **[Complete API Reference](./COMPLETE_API_REFERENCE.md)** 📖
   - All API endpoints documented
   - Request/response examples
   - Error handling

### Want to Deploy Your Own Backend?

1. **[Deployment Guide](./DEPLOYMENT.md)** 🔧
   - Deploy to Supabase
   - Configure environment variables
   - Set up Discord bot

---

## 📖 Full Documentation

### Core Documentation

| Document | Description | Time |
|----------|-------------|-------|
| **[Quick Start Guide](./QUICK_START.md)** | 5-minute integration guide with code examples | 5 min |
| **[Complete API Reference](./COMPLETE_API_REFERENCE.md)** | Comprehensive API documentation for all endpoints | 20 min |
| **[Database Schema](./DATABASE_SCHEMA.md)** | Database structure, indexes, and constraints | 15 min |
| **[Deployment Guide](./DEPLOYMENT.md)** | Deploy your own backend instance | 15 min |

### Integration Documentation

| Document | Description | For |
|----------|-------------|-----|
| **[API Documentation](./API.md)** | Original API reference | All developers |
| **[Database Schema](./DATABASE_SCHEMA.md)** | Database structure reference | Backend developers |
| **[Deployment Guide](./DEPLOYMENT.md)** | Full deployment instructions | Backend maintainers |

### Optional Features

| Document | Description | For |
|----------|-------------|-----|
| **[Discord Setup](./DISCORD_SETUP.md)** | Discord bot integration for moderation | Admins/Backoffice |
| **[Discord Commands](./DISCORD_COMMANDS.md)** | Available Discord moderation commands | Moderators |
| **[CMD Command](./CMD_COMMAND.md)** | Command line interface | System admins |
| **[Actions](./ACTIONS.md)** | Available moderation actions | Moderators |

---

## 🎯 For App Developers

### Integrating Commentum v2

Your app makes HTTP requests to Commentum v2 endpoints:

**Example: Create a Comment**
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/comments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    client_type: 'anilist',
    user_id: '12345',
    media_id: '6789',
    content: 'Great episode!'
  })
});

const comment = await response.json();
```

**Example: Get Comments**
```javascript
const response = await fetch(
  'https://your-project.supabase.co/functions/v1/media?media_id=6789&client_type=anilist&limit=20'
);

const data = await response.json();
const comments = data.comments;
```

**Example: Vote**
```javascript
const response = await fetch('https://your-project.supabase.co/functions/v1/votes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    comment_id: 1,
    user_id: '12345',
    vote_type: 'upvote'
  })
});
```

### Platform Support

Commentum v2 supports multiple platforms via `client_type`:

| Platform | client_type | Documentation |
|----------|--------------|---------------|
| **AniList** | `anilist` | [API Docs](https://anilist.gitbook.io/anilist-apiv2-docs/) |
| **MyAnimeList** | `myanimelist` | [API Docs](https://myanimelist.net/apiconfig/references/api/v2) |
| **SIMKL** | `simkl` | [API Docs](https://simkl.docs.apiary.io/) |
| **Custom** | `other` | Custom implementation |

### Key Features Available via API

- ✅ Nested comments (threaded discussions)
- ✅ Real-time voting (upvote/downvote)
- ✅ Content reporting
- ✅ Edit and delete comments
- ✅ Pinned comments
- ✅ Locked threads
- ✅ User moderation (warn, mute, ban)
- ✅ Auto-fetched user and media metadata
- ✅ Discord notifications (optional)

---

## 🔧 For Backend Developers

### Deploying Your Own Instance

Follow the [Deployment Guide](./DEPLOYMENT.md) to:

1. Create a Supabase project
2. Apply database migrations
3. Deploy Edge Functions
4. Configure environment variables
5. Set up admins and moderators

### Architecture Overview

```
┌─────────────────────────────────────────────────┐
│           Your Applications (Multiple)           │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │   App A  │  │   App B  │  │   App C  ││
│  └──────────┘  └──────────┘  └──────────┘│
└─────────────────────────────────────────────────┘
                    │ REST API
                    ▼
┌─────────────────────────────────────────────────┐
│           Commentum v2 Backend               │
│                                                 │
│  ┌─────────────────────────────────────────┐ │
│  │     Supabase Edge Functions          │ │
│  │                                     │ │
│  │  • /comments                         │ │
│  │  • /votes                            │ │
│  │  • /media                            │ │
│  │  • /reports                          │ │
│  │  • /moderation                       │ │
│  │  • /users                            │ │
│  │  • /discord                          │ │
│  └─────────────────────────────────────────┘ │
│                    │                      │
└────────────────────┼──────────────────────┘
                     │ Database
                     ▼
              ┌──────────────┐
              │  PostgreSQL  │
              │   (Supabase) │
              └──────────────┘
```

### Database Structure

Two-table design optimized for performance:

- **`comments`** - All comment data and metadata
- **`config`** - System configuration
- **`discord_users`** - Discord integration (optional)
- **`discord_notifications`** - Notification logs (optional)

Full details in [Database Schema](./DATABASE_SCHEMA.md).

---

## 🔐 Security

### API Security Model

**Open System Design:**
- ✅ Create comments: No authentication required
- ✅ Read comments: No authentication required
- ✅ Vote: No authentication required
- ✅ Delete own comments: User ID match only

**Authentication Required:**
- 🔑 Edit comments: Platform token verification
- 🔑 Admin actions: Platform token + role verification
- 🔑 Report resolution: Admin only

### Platform Token Verification

When authentication is needed, Commentum v2 verifies tokens against platform APIs:

- **AniList**: GraphQL query to verify user
- **MyAnimeList**: REST API call to verify user
- **SIMKL**: API key verification

This ensures users are who they claim to be without requiring you to manage accounts.

---

## 📊 Performance & Scalability

### Built-in Optimizations

- **Database Indexes**: All major query paths indexed
- **Edge Functions**: Auto-scaling serverless functions
- **Connection Pooling**: Supabase built-in pooling
- **JSON Operations**: Optimized JSONB usage

### Rate Limiting

Default limits (configurable):

| Action | Limit | Per |
|---------|-------|-----|
| Comments | 30 | hour/user |
| Votes | 100 | hour/user |
| Reports | 10 | hour/user |

---

## 🤖 Discord Integration (Optional)

Commentum v2 includes optional Discord bot integration for:

- Real-time comment notifications
- Moderation commands in Discord
- Report alerts
- Statistics dashboard

See [Discord Setup](./DISCORD_SETUP.md) for full details.

---

## 🆘 Support & Resources

### Documentation

- 📖 **[Quick Start Guide](./QUICK_START.md)** - Get started in 5 minutes
- 📖 **[Complete API Reference](./COMPLETE_API_REFERENCE.md)** - Full API docs
- 📖 **[Database Schema](./DATABASE_SCHEMA.md)** - Database reference
- 📖 **[Deployment Guide](./DEPLOYMENT.md)** - Deploy your backend
- 📖 **[Discord Setup](./DISCORD_SETUP.md)** - Discord bot setup

### External Resources

- **Supabase**: https://supabase.com/docs
- **AniList API**: https://anilist.gitbook.io/anilist-apiv2-docs/
- **MyAnimeList API**: https://myanimelist.net/apiconfig/references/api/v2
- **SIMKL API**: https://simkl.docs.apiary.io/

### Getting Help

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: Check docs folder first
- **API Testing**: Use provided Supabase project for testing

---

## 🎯 Quick Reference

### API Endpoints

| Endpoint | Method | Purpose | Auth |
|----------|---------|---------|-------|
| `/comments` | POST | Create/Edit/Delete comments | Conditional |
| `/votes` | POST | Vote on comments | ❌ No |
| `/media` | GET | Get comments for media | ❌ No |
| `/reports` | POST | Report/Resolve reports | Conditional |
| `/moderation` | POST | Moderation actions | ✅ Yes |
| `/users` | POST | Get user roles | Conditional |
| `/discord` | POST | Discord bot | ✅ Discord |

### Response Formats

**Success Response:**
```json
{
  "success": true,
  "comment": { /* comment object */ },
  "data": { /* additional data */ }
}
```

**Error Response:**
```json
{
  "error": "Error description"
}
```

---

## 📝 Usage Examples

### JavaScript/Frontend

```javascript
// Create comment
async function createComment(userId, mediaId, content) {
  const response = await fetch('https://your-project.supabase.co/functions/v1/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      client_type: 'anilist',
      user_id: userId,
      media_id: mediaId,
      content: content
    })
  });
  return await response.json();
}

// Get comments
async function getComments(mediaId) {
  const response = await fetch(
    `https://your-project.supabase.co/functions/v1/media?media_id=${mediaId}&client_type=anilist`
  );
  return await response.json();
}

// Vote
async function vote(commentId, userId, voteType) {
  const response = await fetch('https://your-project.supabase.co/functions/v1/votes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      comment_id: commentId,
      user_id: userId,
      vote_type: voteType
    })
  });
  return await response.json();
}
```

### React Example

```javascript
import { useState, useEffect } from 'react';

function useComments(mediaId) {
  const [comments, setComments] = useState([]);

  useEffect(() => {
    fetch(
      `https://your-project.supabase.co/functions/v1/media?media_id=${mediaId}&client_type=anilist`
    )
      .then(r => r.json())
      .then(data => setComments(data.comments));
  }, [mediaId]);

  return comments;
}

function CommentSection({ mediaId, currentUser }) {
  const comments = useComments(mediaId);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const content = e.target.content.value;
    
    await fetch('https://your-project.supabase.co/functions/v1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        client_type: 'anilist',
        user_id: currentUser.id,
        media_id: mediaId,
        content: content
      })
    });
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea name="content" />
        <button type="submit">Post Comment</button>
      </form>
      {comments.map(c => <CommentCard key={c.id} comment={c} />)}
    </div>
  );
}
```

---

## 🔍 Finding Information

### By Role

**Frontend Developers:**
- Start with [Quick Start Guide](./QUICK_START.md)
- Review [Complete API Reference](./COMPLETE_API_REFERENCE.md)
- Check code examples for your framework

**Backend Developers:**
- Review [Database Schema](./DATABASE_SCHEMA.md)
- Follow [Deployment Guide](./DEPLOYMENT.md)
- Check [API Documentation](./API.md) for implementation details

**Moderators/Admins:**
- Review [Discord Setup](./DISCORD_SETUP.md)
- Check [Discord Commands](./DISCORD_COMMANDS.md)
- Review [Moderation Actions](./ACTIONS.md)

### By Topic

**API Integration:**
- [Quick Start Guide](./QUICK_START.md)
- [Complete API Reference](./COMPLETE_API_REFERENCE.md)
- [API Documentation](./API.md)

**Database:**
- [Database Schema](./DATABASE_SCHEMA.md)

**Deployment:**
- [Deployment Guide](./DEPLOYMENT.md)

**Discord:**
- [Discord Setup](./DISCORD_SETUP.md)
- [Discord Commands](./DISCORD_COMMANDS.md)

**Moderation:**
- [Actions](./ACTIONS.md)
- [CMD Command](./CMD_COMMAND.md)

---

## 🎉 Summary

### What Commentum v2 Is

✅ A backend API service for apps to integrate with
✅ Provides comment functionality via REST API
✅ Handles storage, moderation, voting, reporting
✅ Supports AniList, MyAnimeList, SIMKL platforms
✅ Optional Discord bot integration
✅ Open system design (no API keys required for basic use)

### What Commentum v2 Is Not

❌ NOT a standalone website
❌ NOT a frontend application
❌ NOT something you "fork and build"
❌ NOT a user-facing service

### How to Use

1. **For Apps**: Make HTTP requests to API endpoints
2. **For Backend**: Deploy your own instance using Deployment Guide
3. **For Moderation**: Use API or Discord bot

---

**Ready to integrate?** Start with the [Quick Start Guide](./QUICK_START.md)! 🚀
