# Commentum v2 Documentation

**🎯 Commentum v2 is a BACKEND API SERVICE for apps to integrate with.**

---

## ✨ Features

- 💬 **Comments** - Full CRUD with threading, voting, and moderation
- 🗳️ **Voting** - Upvotes, downvotes, and vote scoring
- 🚨 **Reports** - User reporting and moderation queue
- 🔧 **Moderation** - Pin, lock, warn, mute, ban actions
- 📢 **Announcements** - Multi-app developer announcements
- 🤖 **Discord Integration** - Notifications with Components V2
- 🔐 **Role System** - Hierarchical permissions (owner > super_admin > admin > moderator > user)

---

## 🔐 Authentication

### Token Auth (Mod+ Actions)
```json
{
  "client_type": "anilist",
  "access_token": "oauth_token"
}
```

Verified with provider APIs (AniList, MAL, SIMKL).

### User Info (Basic Actions)
```json
{
  "user_info": {
    "user_id": "12345",
    "username": "TestUser"
  }
}
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Quick Start](./QUICK_START.md) | Integration guide |
| [Complete API Reference](./COMPLETE_API_REFERENCE.md) | All endpoints |
| [Actions](./ACTIONS.md) | Auth requirements |
| [Database Schema](./DATABASE_SCHEMA.md) | DB structure |
| [Deployment](./DEPLOYMENT.md) | Deploy your own |

---

## 🎯 Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/comments` | user_info / token | CRUD comments |
| `/votes` | user_info | Vote on comments |
| `/media` | none | Get comments |
| `/reports` | user_info / token | Reports |
| `/moderation` | token | Moderation |
| `/users` | token | User management |
| `/announcements` | none / token | Multi-app announcements |

---

## 📊 Auth Matrix

| Action | Auth | Min Role |
|--------|------|----------|
| create | user_info | user |
| edit | user_info (owner) | user |
| delete (own) | user_info (owner) | user |
| mod_delete | token | moderator |
| vote | user_info | user |
| report | user_info | user |
| pin/lock | token | moderator |
| warn | token | moderator |
| ban | token | admin |
| list announcements | none | - |
| create announcement | token | super_admin |

---

## 📊 Role Hierarchy

| Role | Level | Display As |
|------|-------|------------|
| owner | 4 | super_admin (hidden) |
| super_admin | 3 | super_admin |
| admin | 2 | admin |
| moderator | 1 | moderator |
| user | 0 | user |

---

## 🤖 Discord Bot

Discord bot uses its own auth system (Discord registration), separate from API token auth.

---

**Start here**: [Quick Start Guide](./QUICK_START.md) 🚀
