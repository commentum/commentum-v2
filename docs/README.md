# Commentum v2 Documentation

**🎯 Commentum v2 is a BACKEND API SERVICE for apps to integrate with.**

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

---

## 🤖 Discord Bot

Discord bot uses its own auth system (Discord registration), separate from API token auth.

---

**Start here**: [Quick Start Guide](./QUICK_START.md) 🚀
