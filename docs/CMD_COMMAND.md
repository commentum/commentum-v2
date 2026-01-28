# 🤖 `/cmd` Command - Command Palette & Registration

## 📋 Overview

The `/cmd` command provides a **user-friendly command palette** and **quick registration interface** for the Commentum Discord bot. It serves as the main entry point for users to discover and use all available commands.

---

## 🎯 **Available Actions**

### `/cmd action:register` - Quick Registration
**Streamlined registration process with helpful guidance**

**Usage:**
```
/cmd action:register platform:anilist user_id:123456 token:your_token
```

**Features:**
- ✅ **Interactive guidance** if parameters are missing
- ✅ **Token instructions** for each platform
- ✅ **One-command registration** when all fields provided
- ✅ **Error handling** with clear feedback

**Platform Token Instructions:**
- **AniList**: Settings → Developer → Create Personal Access Token
- **MyAnimeList**: API Settings → Create Client ID  
- **SIMKL**: Get API Key from SIMKL API settings

---

### `/cmd action:list` - Command List
**Displays all available commands based on your role**

**Shows:**
- 📝 Basic Commands (All users)
- 🛡️ Moderator Commands (Mod+)
- 👑 Admin Commands (Admin+)
- ⚡ Super Admin Commands (Super Admin only)
- 🎯 Quick action shortcuts

**Example Output:**
```
🤖 Commentum Command List

Your Role: moderator

📝 Basic Commands
• /register - Register your account
• /report <comment_id> <reason> - Report content
• /user <user_id> - Get user info
• /comment <comment_id> - Get comment info
• /stats - View statistics
• /help - Show help

🛡️ Moderator Commands
• /warn <user_id> <reason> - Warn user
• /mute <user_id> [duration] <reason> - Mute user
• /pin <comment_id> [reason] - Pin comment
• /lock <comment_id> [reason] - Lock thread
• /resolve <comment_id> <reporter_id> <resolution> - Resolve report
• /queue - View moderation queue
```

---

### `/cmd action:quick` - Quick Actions
**Role-based quick action menu for common tasks**

**User Quick Actions:**
```
⚡ Quick Actions

Your Role: user

🔍 Quick Lookups
• User info: /user <user_id>
• Comment info: /comment <comment_id>
• System stats: /stats

📝 Quick Actions
• Report comment: /report <comment_id> <reason>
• Register: /cmd action:register
• Get help: /help
```

**Moderator Quick Actions:**
```
⚡ Quick Actions

Your Role: moderator

🛡️ Quick Moderation
• Warn user: /warn <user_id> <reason>
• Mute user: /mute <user_id> 24 <reason>
• Pin comment: /pin <comment_id>
• Lock thread: /lock <comment_id>

📊 Quick Info
• Check queue: /queue
• User lookup: /user <user_id>
• Resolve report: /resolve <comment_id> <reporter_id> resolved
```

**Super Admin Quick Actions:**
```
⚡ Quick Actions

Your Role: super_admin

⚡ Quick Super Admin Actions
• Promote user: /promote <user_id> <role>
• Demote user: /demote <user_id> <role>
• Ban/Unban: /ban <user_id> <reason> / /unban <user_id>
• Update config: /config action:update key:<key> value:<value>

🔨 Quick Admin Actions
• Shadow ban: /shadowban <user_id> <reason>
• Delete comment: /delete <comment_id>
• System toggle: /config action:update key:system_enabled value:false
```

---

### `/cmd action:status` - System Status
**Real-time system health and statistics**

**Shows:**
- 🤖 **Bot Status**: Online/Offline
- 💬 **Comments**: Enabled/Disabled
- 🗳️ **Voting**: Enabled/Disabled
- 🚨 **Reporting**: Enabled/Disabled
- 📢 **Discord Notifications**: Enabled/Disabled
- 📊 **Statistics**: Comments, users, roles
- 👤 **Your Role**: Current permission level
- 📅 **Last Check**: Timestamp

**Example Output:**
```
🟢 System Status

🤖 Bot Status: 🟢 Online
💬 Comments: 🟢 Enabled
🗳️ Voting: 🟢 Enabled
🚨 Reporting: 🟢 Enabled
📢 Discord Notifications: 🟢 Enabled

📊 Statistics:
• Total Comments: 1,247
• Active Discord Users: 15
• Moderators: 3
• Admins: 2
• Super Admins: 1

👤 Your Role: moderator
📅 Last Check: 1/24/2026, 2:30:45 PM
```

---

## 🎯 **Usage Examples**

### **New User Registration**
```
/cmd action:register
# Shows registration guide
/cmd action:register platform:anilist user_id:123456 token:your_token
# Registers immediately
```

### **Discover Commands**
```
/cmd action:list
# Shows all commands for your role
/cmd action:quick
# Shows quick actions for your role
```

### **Quick System Check**
```
/cmd action:status
# Shows system health and stats
```

### **Power User Workflow**
```
/cmd action:quick          # See quick actions
/cmd action:status          # Check system status
/cmd action:list           # See all commands
```

---

## 🎨 **Key Features**

### **🔍 Smart Parameter Handling**
- Provides helpful guidance when parameters are missing
- Shows examples and token instructions
- Handles incomplete commands gracefully

### **👤 Role-Aware Display**
- Shows only commands relevant to your permission level
- Adapts interface based on user role
- Prevents confusion with unavailable commands

### **⚡ Quick Access**
- One-command access to most common tasks
- Role-based quick action menus
- Fast system status checks

### **📊 Real-Time Information**
- Live system status with emojis
- Current statistics and user counts
- Last update timestamps

### **🎯 User-Friendly**
- Clear, structured output
- Helpful examples and instructions
- Consistent formatting and colors

---

## 🚀 **Why Use `/cmd`?**

### **For New Users**
- **Easy Discovery**: Find all available commands
- **Simple Registration**: Guided sign-up process
- **Quick Help**: Get started without memorizing commands

### **For Regular Users**
- **Fast Access**: Quick actions for common tasks
- **Status Checks**: Monitor system health
- **Command Reference**: Look up syntax when needed

### **For Moderators & Admins**
- **Role-Specific Actions**: See only relevant commands
- **Quick Moderation**: Fast access to common mod actions
- **System Monitoring**: Real-time status and statistics

### **For Super Admins**
- **Complete Control**: Access to all system functions
- **Quick Configuration**: Fast system changes
- **Administrative Tools**: Role management and system settings

---

## 🎉 **Benefits**

✅ **User-Friendly**: Intuitive interface for all users  
✅ **Role-Aware**: Adapts to permission levels  
✅ **Time-Saving**: Quick access to common actions  
✅ **Informative**: Real-time system status  
✅ **Guided**: Helpful instructions and examples  
✅ **Comprehensive**: Complete command coverage  

**The `/cmd` command transforms your Discord bot into a user-friendly command center that anyone can use effectively!** 🚀