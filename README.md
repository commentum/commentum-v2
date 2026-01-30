# Commentum v2 - Comment Backend API Service

**🎯 IMPORTANT: This is a BACKEND API SERVICE for apps to integrate with, NOT a standalone application to deploy or fork.**

---

## What is Commentum v2?

Commentum v2 is a **production-ready comment system backend** that provides API endpoints for apps to integrate comment functionality. It's built on Supabase Edge Functions and designed for applications using AniList, MyAnimeList (MAL), SIMKL, or custom platforms.

**Use this backend service to add comprehensive comment features to your existing apps.**

---

## 🚀 Core Purpose

Commentum v2 serves as a **centralized comment infrastructure** that multiple applications can consume via REST API:

- ✅ Your anime/manga apps can use it for comments
- ✅ Your movie/TV apps can use it for discussions
- ✅ Any app can integrate comment functionality without building it from scratch

**This is NOT:**
- ❌ A standalone comment website
- ❌ A frontend application
- ❌ Something you "fork and deploy"
- ❌ A user-facing service

**This IS:**
- ✅ A backend API service
- ✅ For apps to integrate with via API calls
- ✅ A reusable comment infrastructure
- ✅ Centralized moderation and content management

---

## 🎯 How It Works

### For App Developers

1. **Your App** makes API calls to Commentum v2 endpoints
2. **Commentum v2** processes and stores comment data
3. **Your App** displays comments to users
4. **Commentum v2** handles moderation, voting, reporting, etc.

```
┌─────────────┐           API           ┌───────────────┐
│   Your App  │ ◄─────────────────────► │ Commentum v2  │
│ (Frontend)  │                         │ (Backend API) │
└─────────────┘                         └───────────────┘
      │                                       │
      │ Displays                              │ Stores &
      │ Comments                              │ Moderates
      ▼                                       ▼
   Users                                PostgreSQL DB
```

### Integration Example

Your app makes simple HTTP requests:

```javascript
// Create a comment from your app
const response = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/comments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'create',
    client_type: 'anilist',  // Your platform
    user_info: {
      user_id: currentUser.id,
      username: currentUser.name,
      avatar: currentUser.avatar
    },
    media_info: {
      media_id: animeId,
      type: 'anime',
      title: animeTitle,
      year: animeYear,
      poster: animePoster
    },
    content: userComment
  })
});

// Get comments for a media
const comments = await fetch(
  `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/media?media_id=${animeId}&client_type=anilist`
).then(r => r.json());

// Vote on a comment
const voteResponse = await fetch('https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/votes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    comment_id: commentId,
    user_info: {
      user_id: currentUser.id,
      username: currentUser.name
    },
    vote_type: 'upvote'
  })
});
```

---

## ✨ Features Provided by This Backend

### Core Comment Features
- **Nested Comments**: Threaded discussions with configurable depth
- **Real-time Voting**: Upvote/downvote system
- **User Reports**: Content reporting and moderation queue
- **Edit & Delete**: Full comment lifecycle management
- **Auto-fetched Metadata**: User & media info from platform APIs

### Advanced Moderation
- **Pin Comments**: Highlight important discussions
- **Lock Threads**: Freeze comment threads when needed
- **User Warnings**: Multi-level warning system
- **User Muting**: Temporary comment restrictions
- **User Banning**: Permanent comment blocking
- **Shadow Banning**: Hidden comment restrictions

### Platform Support
- **AniList**: GraphQL API integration
- **MyAnimeList**: REST API integration
- **SIMKL**: REST API integration
- **Other**: Custom platform support

### Security & Reliability
- **Rate Limiting**: Configurable limits per user
- **Content Filtering**: Banned keyword detection
- **Row Level Security**: Database-level access control
- **Audit Logging**: Complete action history
- **Discord Notifications**: Optional moderation alerts

---

## 📚 API Documentation

### Quick Start

**Base URL**: `https://whzwmfxngelicmjyxwmr.supabase.co/functions/v1/`

**🔑 NO API KEYS REQUIRED** - Open system design

**Core Endpoints**:

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `/comments` | Create, edit, delete comments | Edit/delete only |
| `/votes` | Upvote/downvote comments | ❌ No |
| `/media` | Get comments for media | ❌ No |
| `/reports` | Report and manage content | Admin only |
| `/moderation` | Admin moderation actions | ✅ Yes |
| `/users` | Get user roles | ❌ No |
| `/discord` | Discord bot integration | ✅ Yes |

**Quick Examples**:

```bash
# Create comment (no auth needed)
curl -X POST "https://your-project.supabase.co/functions/v1/comments" \
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

# Get comments (no auth needed)
curl "https://your-project.supabase.co/functions/v1/media?media_id=6789&client_type=anilist&limit=10"

# Vote on comment (no auth needed)
curl -X POST "https://your-project.supabase.co/functions/v1/votes" \
  -H "Content-Type: application/json" \
  -d '{
    "comment_id": 123,
    "user_info": {
      "user_id": "12345",
      "username": "TestUser"
    },
    "vote_type": "upvote"
  }'
```

### Full Documentation

📖 **[Complete API Reference](./docs/COMPLETE_API_REFERENCE.md)** - Comprehensive documentation for all endpoints

📖 **[Quick Start Guide](./docs/QUICK_START.md)** - 5-minute integration guide

📖 **[Database Schema](./docs/DATABASE_SCHEMA.md)** - Database structure reference

---

## 🛠️ For Backend Developers

### Deploy Your Own Instance

If you want to deploy Commentum v2 for your own apps:

**Prerequisites**:
- Supabase account and project
- Optional: Platform API credentials (for user/media info fetching)

**Setup Steps**:

1. **Clone this repository**
   ```bash
   git clone https://github.com/commentum/commentum-v2.git
   cd commentum-v2
   ```

2. **Apply database migrations**
   ```bash
   supabase db push
   ```

3. **Deploy Edge Functions**
   ```bash
   supabase functions deploy .
   ```

4. **Configure environment variables** (in Supabase Dashboard):
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

5. **Optional: Configure platform API keys**
   ```
   MYANIMELIST_CLIENT_ID=your_mal_client_id
   SIMKL_CLIENT_ID=your_simkl_client_id
   ```

**That's it!** Your backend is now ready for apps to integrate.

### Configuration

All settings are stored in the database `config` table and can be updated without code changes:

```sql
-- Update comment length limit
UPDATE config SET value = '5000' WHERE key = 'max_comment_length';

-- Add moderators
UPDATE config SET value = '[123, 456, 789]' WHERE key = 'moderator_users';

-- Enable/disable features
UPDATE config SET value = 'true' WHERE key = 'voting_enabled';
UPDATE config SET value = 'true' WHERE key = 'reporting_enabled';
```

---

## 🎯 Usage Scenarios

### 1. AniList App Integration

Your AniList-based app can add comments:

```javascript
// User creates a comment on anime page
await createComment({
  client_type: 'anilist',
  user_id: currentUser.id,
  media_id: animeId,
  content: commentText
});

// Display comments on anime page
const comments = await getComments(animeId, 'anilist');
renderComments(comments);
```

### 2. Multi-Platform App

One backend serves multiple platforms:

```javascript
// Platform-specific comment retrieval
const anilistComments = await getComments(animeId, 'anilist');
const malComments = await getComments(animeId, 'myanimelist');
const simklComments = await getComments(animeId, 'simkl');
```

### 3. Content Aggregator

Use Commentum v2 as a unified comment backend:

```javascript
// Your aggregator app shows comments from different sources
const unifiedComments = await Promise.all([
  getComments(item.anilistId, 'anilist'),
  getComments(item.malId, 'myanimelist')
]);
```

---

## 🔧 Moderation & Management

### Admin Actions

Admins can moderate content via API:

```javascript
// Pin important comment
await moderateComment({
  action: 'pin_comment',
  comment_id: 123,
  moderator_info: {
    user_id: adminId,
    username: 'AdminUser'
  },
  reason: 'Official announcement'
});

// Lock problematic thread
await moderateComment({
  action: 'lock_thread',
  comment_id: 456,
  moderator_info: {
    user_id: adminId,
    username: 'AdminUser'
  },
  reason: 'Flame war'
});

// Ban spammer
await moderateUser({
  action: 'ban_user',
  target_user_id: 789,
  moderator_info: {
    user_id: adminId,
    username: 'AdminUser'
  },
  reason: 'Repeated spam',
  shadow_ban: true
});

// Report a comment
await reportComment({
  action: 'create',
  comment_id: 123,
  reporter_info: {
    user_id: reporterId,
    username: 'ReporterUser'
  },
  reason: 'spam',
  notes: 'This is spam content'
});
```

### Discord Bot Integration

Optional Discord bot for real-time moderation:

📖 **[Discord Setup Guide](./docs/DISCORD_SETUP.md)**

Features:
- Real-time comment notifications
- Moderation commands in Discord
- Report alerts
- Statistics dashboard

---

## 📊 Architecture

### Backend Stack

- **Platform**: Supabase (PostgreSQL + Edge Functions)
- **Language**: TypeScript / Deno
- **Database**: PostgreSQL with RLS
- **Caching**: Database-level optimization
- **API**: RESTful endpoints

### Database Schema

Two-table design for simplicity and performance:

- **`comments`**: All comment data and metadata
- **`config`**: System configuration and settings
- **`discord_users`**: Discord bot integration
- **`discord_notifications`**: Notification tracking

📖 **[Database Schema Documentation](./docs/DATABASE_SCHEMA.md)**

### Edge Functions

- `/comments` - Comment CRUD operations
- `/votes` - Voting system
- `/reports` - Reporting and moderation queue
- `/moderation` - Advanced moderation actions
- `/media` - Comment retrieval and pagination
- `/users` - User role management
- `/discord` - Discord bot integration
- `/shared` - Common utilities and auth

---

## 🔐 Authentication Model

### Open System Design

**Key Principle**: Most operations don't require authentication

**No Auth Required**:
- ✅ Creating comments
- ✅ Reading comments
- ✅ Voting
- ✅ Deleting own comments (user_id match only)
- ✅ Getting user roles

**Auth Required**:
- 🔑 Editing comments (user_id match only)
- 🔑 Admin actions (role verification only)
- 🔑 Report resolution (admin only)

### User Information Provided by Frontend

The system trusts the frontend to provide user information:

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

Admin and moderator actions are verified against database-stored role lists:

```json
{
  "moderator_info": {
    "user_id": "12345",
    "username": "ModeratorUser"
  }
}
```

The system checks if the user_id is in the moderator_users, admin_users, or super_admin_users config lists.

---

## ⚙️ Configuration Options

All settings stored in database `config` table:

| Key | Type | Default | Description |
|-----|------|----------|-------------|
| `max_comment_length` | INTEGER | 10000 | Maximum comment characters |
| `max_nesting_level` | INTEGER | 10 | Maximum reply depth |
| `system_enabled` | BOOLEAN | true | Master system toggle |
| `voting_enabled` | BOOLEAN | true | Enable voting system |
| `reporting_enabled` | BOOLEAN | true | Enable reporting |
| `rate_limit_comments_per_hour` | INTEGER | 30 | Comment rate limit |
| `rate_limit_votes_per_hour` | INTEGER | 100 | Vote rate limit |
| `banned_keywords` | JSON | [] | Prohibited keywords |
| `super_admin_users` | JSON | [] | Super admin IDs |
| `moderator_users` | JSON | [] | Moderator IDs |
| `admin_users` | JSON | [] | Admin IDs |

---

## 🚦 Rate Limiting

Per-user rate limits (configurable):

- **Comments**: 30 per hour
- **Votes**: 100 per hour
- **Reports**: 10 per hour

When rate limited: Returns `429 Too Many Requests`

---

## 📈 Performance

### Optimizations

- **Database Indexes**: All major query paths indexed
- **Pagination**: Efficient result limiting
- **JSON Operations**: JSONB for performance
- **RLS Policies**: Security at database level
- **Connection Pooling**: Supabase built-in pooling

### Scalability

- **Edge Functions**: Auto-scaling infrastructure
- **Database**: PostgreSQL with connection pooling
- **Caching**: Database query optimization
- **Horizontal Scaling**: Multiple Supabase projects possible

---

## 🔒 Security Features

- **Row Level Security**: Database-level access control
- **Token Verification**: Platform API validation
- **Rate Limiting**: Abuse prevention
- **Content Filtering**: Banned keyword detection
- **IP Tracking**: Optional IP logging
- **Audit Logging**: Complete action history
- **Shadow Banning**: Hidden content restrictions

---

## 🌐 Multi-Tenancy

### Using This Backend for Multiple Apps

Commentum v2 supports multiple apps via `client_type`:

```javascript
// App A uses anilist client type
await createComment({ client_type: 'anilist', ... });

// App B uses myanimelist client type
await createComment({ client_type: 'myanimelist', ... });

// App C uses custom client type
await createComment({ client_type: 'other', ... });
```

Each `client_type` has isolated comment spaces.

---

## 📱 Client Integration

### Recommended Client Libraries

You can use any HTTP client to integrate:

- **JavaScript**: `fetch` API, axios
- **React**: Custom hooks using fetch
- **Vue**: Axios or fetch wrappers
- **Mobile**: HTTP libraries (AFNetworking, Retrofit, etc.)
- **Backend**: Any HTTP client library

### Example: React Hook

```javascript
import { useState, useEffect } from 'react';

function useComments(mediaId, clientType) {
  const [comments, setComments] = useState([]);

  useEffect(() => {
    fetch(
      `https://your-project.supabase.co/functions/v1/media?media_id=${mediaId}&client_type=${clientType}`
    )
      .then(r => r.json())
      .then(data => setComments(data.comments));
  }, [mediaId, clientType]);

  return comments;
}
```

---

## 🆘 Support & Resources

### Documentation

- 📖 **[Complete API Reference](./docs/COMPLETE_API_REFERENCE.md)**
- 📖 **[Quick Start Guide](./docs/QUICK_START.md)**
- 📖 **[Database Schema](./docs/DATABASE_SCHEMA.md)**
- 📖 **[Discord Setup](./docs/DISCORD_SETUP.md)**
- 📖 **[Deployment Guide](./docs/DEPLOYMENT.md)**

### External APIs

- **Supabase**: https://supabase.com
- **AniList API**: https://anilist.gitbook.io/anilist-apiv2-docs/
- **MyAnimeList API**: https://myanimelist.net/apiconfig/references/api/v2
- **SIMKL API**: https://simkl.docs.apiary.io/

### Getting Help

- **GitHub Issues**: Report bugs and feature requests
- **Documentation**: Check docs folder first
- **API Testing**: Use the provided Supabase project

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🎉 Summary

**Commentum v2 is a backend API service that:**

✅ Provides comment functionality via REST API
✅ Integrates with AniList, MAL, SIMKL platforms
✅ Handles moderation, voting, reporting
✅ Requires minimal setup to deploy
✅ Can serve multiple applications
✅ Offers Discord bot integration
✅ No API keys required for basic use

**Apps integrate with Commentum v2, users interact with apps.**

**Commentum v2 handles all the backend complexity.**

---

**Ready to integrate?** Start with the [Quick Start Guide](./docs/QUICK_START.md) 🚀
