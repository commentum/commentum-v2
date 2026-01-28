# 🤖 Complete Discord Bot Command Reference

## 📋 Overview

The Commentum v2 Discord bot provides **comprehensive moderation and management capabilities** with **25+ commands** covering every aspect of comment system administration.

---

## 🎯 Role-Based Command Access

| Command Category | User | Mod | Admin | Super Admin |
|------------------|------|-----|-------|-------------|
| **Registration** | ✅ | ✅ | ✅ | ✅ |
| **Information** | ✅ | ✅ | ✅ | ✅ |
| **Reporting** | ✅ | ✅ | ✅ | ✅ |
| **Basic Moderation** | ❌ | ✅ | ✅ | ✅ |
| **User Management** | ❌ | ❌ | ✅ | ✅ |
| **Role Management** | ❌ | ❌ | ❌ | ✅ |
| **System Config** | ❌ | ❌ | ❌ | ✅ |

---

## 📝 **User Commands** (All Users)

### `/register`
**Register your Discord account with Commentum**
- `platform`: Choose your platform (AniList, MyAnimeList, SIMKL)
- `user_id`: Your platform user ID  
- `token`: Your platform access token

**Example:**
```
/register platform:anilist user_id:123456 token:your_anilist_token
```

### `/report`
**Report a comment for moderation**
- `comment_id`: Comment ID to report
- `reason`: Report reason (Spam, Offensive, Harassment, Spoiler, NSFW, Off Topic, Other)
- `notes`: Additional notes (optional)

**Example:**
```
/report comment_id:42 reason:spam notes:"This looks like automated spam"
```

### `/user`
**Get detailed user information**
- `user_id`: Platform user ID to lookup

**Example:**
```
/user user_id:123456
```

### `/comment`
**Get detailed comment information**
- `comment_id`: Comment ID to lookup

**Example:**
```
/comment comment_id:42
```

### `/stats`
**View system statistics**
- No parameters required

### `/help`
**Show help information based on your role**
- No parameters required

---

## 🛡️ **Moderator Commands** (Mod+)

### `/warn`
**Warn a user**
- `user_id`: Platform user ID to warn
- `reason`: Reason for warning

**Example:**
```
/warn user_id:789012 reason:"Please follow the community guidelines"
```

### `/mute`
**Mute a user for specified duration**
- `user_id`: Platform user ID to mute
- `duration`: Duration in hours (default: 24)
- `reason`: Reason for muting

**Example:**
```
/mute user_id:789012 duration:48 reason:"Repeated rule violations"
```

### `/unmute`
**Remove mute from a user**
- `user_id`: Platform user ID to unmute
- `reason`: Reason for unmuting (optional)

**Example:**
```
/unmute user_id:789012 reason:"User has apologized"
```

### `/pin`
**Pin a comment to highlight it**
- `comment_id`: Comment ID to pin
- `reason`: Reason for pinning (optional)

**Example:**
```
/pin comment_id:42 reason:"Excellent discussion point"
```

### `/unpin`
**Unpin a comment**
- `comment_id`: Comment ID to unpin
- `reason`: Reason for unpinning (optional)

**Example:**
```
/unpin comment_id:42 reason:"Discussion has moved on"
```

### `/lock`
**Lock a comment thread to prevent replies**
- `comment_id`: Comment ID to lock
- `reason`: Reason for locking (optional)

**Example:**
```
/lock comment_id:42 reason:"Thread getting off-topic"
```

### `/unlock`
**Unlock a comment thread**
- `comment_id`: Comment ID to unlock
- `reason`: Reason for unlocking (optional)

**Example:**
```
/unlock comment_id:42 reason:"Issue has been resolved"
```

### `/resolve`
**Resolve a reported comment**
- `comment_id`: Comment ID with report
- `reporter_id`: Reporter user ID
- `resolution`: Resolution type (Resolved, Dismissed)
- `notes`: Review notes (optional)

**Example:**
```
/resolve comment_id:42 reporter_id:111222 resolution:resolved notes:"No violation found"
```

### `/queue`
**View moderation queue of pending reports**
- No parameters required

---

## 👑 **Admin Commands** (Admin+)

### All Moderator Commands Plus:

### `/ban`
**Ban a user from the system**
- `user_id`: Platform user ID to ban
- `reason`: Reason for ban
- `shadow`: Shadow ban (true/false) (optional)

**Example:**
```
/ban user_id:789012 reason:"Repeated spam and harassment" shadow:false
```

### `/unban`
**Unban a user**
- `user_id`: Platform user ID to unban
- `reason`: Reason for unban (optional)

**Example:**
```
/unban user_id:789012 reason:"User has appealed successfully"
```

### `/shadowban`
**Shadow ban a user (user sees their content but others don't)**
- `user_id`: Platform user ID to shadow ban
- `reason`: Reason for shadow ban

**Example:**
```
/shadowban user_id:789012 reason:"Subtle rule violations"
```

### `/unshadowban`
**Remove shadow ban from a user**
- `user_id`: Platform user ID to unshadow ban
- `reason`: Reason for removing shadow ban (optional)

**Example:**
```
/unshadowban user_id:789012 reason:"User behavior has improved"
```

### `/delete`
**Delete any comment (including other users')**
- `comment_id`: Comment ID to delete

**Example:**
```
/delete comment_id:42
```

---

## ⚡ **Super Admin Commands** (Super Admin Only)

### All Admin Commands Plus:

### `/promote`
**Promote a user to higher role**
- `user_id`: Platform user ID to promote
- `role`: New role (Moderator, Admin, Super Admin)
- `reason`: Reason for promotion (optional)

**Example:**
```
/promote user_id:123456 role:moderator reason:"Excellent community contributions"
```

### `/demote`
**Demote a user to lower role**
- `user_id`: Platform user ID to demote
- `role`: New role (User, Moderator, Admin)
- `reason`: Reason for demotion (optional)

**Example:**
```
/demote user_id:789012 role:user reason:"Abuse of moderator privileges"
```

### `/config`
**View or update system configuration**
- `action`: Action to perform (View Config, Update Config)
- `key`: Configuration key (for update)
- `value`: New configuration value (for update)

**Examples:**
```
/config action:view
/config action:update key:max_comment_length value:"5000"
/config action:update key:discord_notifications_enabled value:"false"
```

---

## 📊 **Information Commands**

### `/stats` - System Statistics
Shows:
- Total comments, upvotes, downvotes, reports
- Active Discord users by role
- System health metrics

### `/user <user_id>` - User Information
Shows:
- Username, platform, role
- Account status (banned, muted, shadow banned)
- Comment statistics
- Warning count

### `/comment <comment_id>` - Comment Information
Shows:
- Comment content and metadata
- Author information
- Vote counts and reports
- Moderation status
- Media information

### `/queue` - Moderation Queue
Shows:
- Pending reports with details
- Report reasons and counts
- Comment previews

### `/help` - Role-Based Help
Shows commands available to your specific role

---

## 🔧 **Configuration Keys**

Super Admins can update these using `/config action:update`:

| Key | Description | Default |
|-----|-------------|---------|
| `max_comment_length` | Maximum comment characters | "10000" |
| `max_nesting_level` | Maximum reply depth | "10" |
| `rate_limit_comments_per_hour` | Comment rate limit | "30" |
| `rate_limit_votes_per_hour` | Vote rate limit | "100" |
| `rate_limit_reports_per_hour` | Report rate limit | "10" |
| `system_enabled` | Enable/disable system | "true" |
| `voting_enabled` | Enable/disable voting | "true" |
| `reporting_enabled` | Enable/disable reporting | "true" |
| `discord_notifications_enabled` | Enable Discord notifications | "true" |
| `discord_webhook_url` | Discord webhook URL | "" |
| `banned_keywords` | Banned words list | "[]" |

---

## 🎨 **Command Examples by Role**

### New User Registration
```
/register platform:anilist user_id:123456 token:your_token_here
```

### Daily Moderation
```
/queue                    # Check reports
/warn user_id:789012 reason:"Please be respectful"
/pin comment_id:42 reason:"Great discussion"
/lock comment_id:15 reason:"Off-topic debate"
```

### User Management (Admin)
```
/ban user_id:789012 reason:"Repeated harassment"
/shadowban user_id:111222 reason:"Subtle spam"
/unban user_id:333444 reason:"Successful appeal"
```

### Role Management (Super Admin)
```
/promote user_id:555666 role:moderator reason:"Active helper"
/demote user_id:777888 role:user reason:"Policy violations"
/config action:update key:max_comment_length value:"8000"
```

---

## 🚨 **Important Notes**

### Security
- All actions are logged with user ID and timestamp
- Role permissions are strictly enforced
- Token verification required for registration

### Rate Limits
- Commands respect system rate limits
- Failed actions are logged for audit

### Error Handling
- Commands provide clear error messages
- Insufficient permissions are clearly indicated
- Invalid parameters show usage examples

### Notifications
- All moderation actions send Discord notifications
- Media previews included in notifications
- Failed notifications are retried automatically

---

## 🎉 **Complete Command Coverage**

The bot now provides **complete coverage** of all Commentum v2 functionality:

✅ **User Management**: Register, lookup, statistics  
✅ **Content Moderation**: Warn, mute, ban, shadow ban  
✅ **Comment Control**: Pin, lock, delete, edit, report  
✅ **Role Administration**: Promote, demote, permissions  
✅ **System Configuration**: View, update, disable features  
✅ **Information & Analytics**: Stats, queues, user data  
✅ **Real-time Notifications**: All actions logged to Discord  

**Your Discord server is now a complete command center for Commentum v2!** 🚀