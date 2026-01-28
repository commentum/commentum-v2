# Deployment Guide - Commentum v2 Backend API Service

**🎯 IMPORTANT**: This guide shows you how to deploy your own **Commentum v2 backend API instance** that your apps can integrate with.

**This is NOT about deploying a frontend website or app.**

---

## 📋 What You're Deploying

You're deploying a **backend API service** that:

- Provides comment functionality via REST API
- Manages comment storage in PostgreSQL
- Handles voting, moderation, reporting
- Serves multiple apps via API calls

```
┌─────────────┐      API Calls       ┌──────────────┐
│   Your App  │ ◄─────────────────► │ Commentum v2  │
│ (Frontend)  │                       │ (Backend API)  │
└─────────────┘                       └──────────────┘
                                            │
                                            │ You Deploy
                                            ▼
                                    Supabase Project
```

---

## 🎯 Prerequisites

### Required

- **Supabase Account**: Free account at https://supabase.com
- **GitHub Account**: For cloning and managing code (optional)
- **Basic Terminal Knowledge**: For running commands

### Optional

- **Platform API Keys**:
  - MyAnimeList Client ID (for user/media info)
  - SIMKL Client ID (for user/media info)
  - AniList uses public API (no key needed)

- **Discord Bot** (for moderation notifications):
  - Discord Developer Account
  - Bot Token
  - Webhook URL(s)

---

## 🚀 Deployment Steps

### Step 1: Clone the Repository

```bash
git clone https://github.com/commentum/commentum-v2.git
cd commentum-v2
```

### Step 2: Install Supabase CLI

```bash
# Using npm
npm install -g supabase

# Using Homebrew (macOS)
brew install supabase/tap/supabase

# Verify installation
supabase --version
```

### Step 3: Link to Your Supabase Project

1. **Create a new Supabase project** at https://supabase.com/dashboard
2. **Copy your project URL** and **Anon Key** from Settings > API
3. **Link the project**:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Your project reference is the part of your Supabase URL: `https://[project-ref].supabase.co`

### Step 4: Apply Database Migrations

```bash
# Push all migrations to your database
supabase db push

# Verify tables were created
supabase db remote tables
```

This creates:
- `comments` table
- `config` table
- `discord_users` table
- `discord_notifications` table
- All indexes, triggers, and RLS policies

### Step 5: Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy .

# Or deploy specific function
supabase functions deploy comments
supabase functions deploy votes
supabase functions deploy reports
supabase functions deploy moderation
supabase functions deploy media
supabase functions deploy users
supabase functions deploy discord
```

### Step 6: Configure Environment Variables

Go to your Supabase Dashboard > Edge Functions:

**Required Variables:**
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Get these from: Settings > API

**Optional Variables:**
```bash
# Platform API Keys (for auto-fetching user/media info)
MYANIMELIST_CLIENT_ID=your_mal_client_id
SIMKL_CLIENT_ID=your_simkl_client_id

# Discord Bot (for moderation notifications)
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_PUBLIC_KEY=your_public_key
DISCORD_CLIENT_ID=your_client_id
DISCORD_GUILD_ID=your_guild_id
DISCORD_WEBHOOK_URL=your_webhook_url
```

### Step 7: Verify Deployment

```bash
# Test the API
curl -X POST "https://[your-project].supabase.co/functions/v1/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "Test comment from deployment!"
  }'
```

If successful, you should get a response with the created comment.

---

## ⚙️ Initial Configuration

### Set Up Admins and Moderators

Update the `config` table in your Supabase Dashboard:

```sql
-- Add moderators (replace with actual user IDs)
UPDATE config 
SET value = '[123, 456, 789]' 
WHERE key = 'moderator_users';

-- Add admins
UPDATE config 
SET value = '[999]' 
WHERE key = 'admin_users';

-- Add super admins (full system access)
UPDATE config 
SET value = '[999]' 
WHERE key = 'super_admin_users';
```

### Configure System Settings

```sql
-- Adjust comment length limit
UPDATE config 
SET value = '5000' 
WHERE key = 'max_comment_length';

-- Set max nesting depth for replies
UPDATE config 
SET value = '5' 
WHERE key = 'max_nesting_level';

-- Adjust rate limits
UPDATE config 
SET value = '50' 
WHERE key = 'rate_limit_comments_per_hour';

-- Enable/disable features
UPDATE config 
SET value = 'true' 
WHERE key = 'voting_enabled';
```

### Add Banned Keywords

```sql
UPDATE config 
SET value = '["spam", "offensive", "harassment"]' 
WHERE key = 'banned_keywords';
```

---

## 🌐 Setting Up Platform API Keys

### MyAnimeList

1. Go to https://myanimelist.net/apiconfig
2. Click "Create ID"
3. Fill in application details
4. Copy the Client ID
5. Add to Supabase Dashboard > Edge Functions > Environment Variables:

```bash
MYANIMELIST_CLIENT_ID=your_client_id_here
```

### SIMKL

1. Go to https://simkl.com/api/apps
2. Create new application
3. Copy the Client ID
4. Add to environment variables:

```bash
SIMKL_CLIENT_ID=your_client_id_here
```

### AniList

No API key needed! AniList's public GraphQL API is used.

---

## 🤖 Setting Up Discord Bot (Optional)

### Create Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name (e.g., "Commentum Bot")
4. Go to "Bot" section
5. Click "Add Bot"
6. Copy the **Token** (this is `DISCORD_BOT_TOKEN`)

### Get Public Key

1. In bot settings, go to "General Information"
2. Copy the **Public Key** (this is `DISCORD_PUBLIC_KEY`)
3. Also copy the **Application ID** (this is `DISCORD_CLIENT_ID`)

### Create Webhook (Optional)

1. In your Discord server, go to Server Settings > Integrations
2. Create Webhook
3. Copy the **Webhook URL** (this is `DISCORD_WEBHOOK_URL`)

### Get Guild ID

1. Enable Developer Mode in Discord
2. Right-click your server icon
3. Copy the Server ID (this is `DISCORD_GUILD_ID`)

### Deploy Discord Endpoint

```bash
# Deploy Discord function specifically
supabase functions deploy discord
```

### Configure Discord Interaction Endpoint

1. In Discord Developer Portal, go to your application
2. Go to "General Information"
3. Set "Interactions Endpoint URL" to:
   ```
   https://[your-project].supabase.co/functions/v1/discord
   ```

### Test Discord Bot

Invite the bot to your server using:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

---

## ✅ Verification Checklist

After deployment, verify:

### API Endpoints

- [ ] `/comments` - Create a test comment
- [ ] `/media` - Retrieve comments for media
- [ ] `/votes` - Vote on a comment
- [ ] `/users` - Get user role

### Database Tables

- [ ] `comments` table exists with test data
- [ ] `config` table has default settings
- [ ] `discord_users` table exists (if using Discord)
- [ ] `discord_notifications` table exists (if using Discord)

### Configuration

- [ ] Admins and moderators configured
- [ ] Rate limits set as desired
- [ ] Feature toggles configured
- [ ] Platform API keys added (optional)

### Discord (if enabled)

- [ ] Bot responds to commands
- [ ] Webhook notifications working
- [ ] User registration works

---

## 🔒 Security Best Practices

### Environment Variables

- ✅ Never commit `.env` files
- ✅ Rotate service role key if compromised
- ✅ Use different keys for production/staging
- ✅ Limit Discord bot permissions

### Database Access

- ✅ Only backend functions access database
- ✅ RLS policies properly configured
- ✅ Regular backups enabled
- ✅ Monitor database performance

### API Security

- ✅ Enable Supabase rate limiting
- ✅ Monitor Edge Function logs
- ✅ Set up alerts for suspicious activity
- ✅ Keep dependencies updated

---

## 📊 Monitoring and Maintenance

### Monitoring

**Supabase Dashboard:**
- Edge Function logs
- Database queries
- Performance metrics
- Storage usage

**Key Metrics to Track:**
- API request rate
- Database query time
- Error rates
- Comment volume

### Regular Maintenance

**Weekly:**
- Review error logs
- Check rate limit triggers
- Verify backups completed

**Monthly:**
- Review moderation queue
- Update banned keywords
- Audit admin access
- Review performance metrics

---

## 🔄 Updates and Migrations

### Updating Code

```bash
# Pull latest changes
git pull origin main

# Deploy updated functions
supabase functions deploy .
```

### Database Migrations

```bash
# Create new migration
supabase migration new add_new_feature

# Edit migration file
# Add your SQL changes

# Push changes
supabase db push

# Or generate SQL for review
supabase db diff
```

---

## 🧪 Testing Your Deployment

### Manual Testing

```bash
# Create comment
curl -X POST "https://[your-project].supabase.co/functions/v1/comments" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "anilist",
    "user_id": "test_user",
    "media_id": "test_media",
    "content": "Test comment"
  }'

# Get comments
curl "https://[your-project].supabase.co/functions/v1/media?media_id=test_media&client_type=anilist"

# Vote on comment
curl -X POST "https://[your-project].supabase.co/functions/v1/votes" \
  -H "Content-Type: application/json" \
  -d '{
    "comment_id": 1,
    "user_id": "test_user",
    "vote_type": "upvote"
  }'
```

### Integration Testing

Create a simple test app to verify:

```javascript
async function testAPI() {
  const baseURL = 'https://[your-project].supabase.co/functions/v1';

  // Test comment creation
  const comment = await fetch(`${baseURL}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      client_type: 'anilist',
      user_id: 'test',
      media_id: 'test',
      content: 'Integration test'
    })
  }).then(r => r.json());

  console.log('Created comment:', comment);

  // Test retrieval
  const comments = await fetch(`${baseURL}/media?media_id=test&client_type=anilist`)
    .then(r => r.json());

  console.log('Retrieved comments:', comments);
}

testAPI();
```

---

## 🚦 Scaling

### High Volume Deployment

For high-traffic deployments:

1. **Multiple Supabase Projects**:
   - Separate projects for different regions
   - Load balance across projects

2. **Database Optimization**:
   - Add partial indexes for common queries
   - Archive old deleted comments
   - Consider read replicas

3. **Edge Function Optimization**:
   - Enable caching headers
   - Optimize database queries
   - Use connection pooling

---

## 🐛 Troubleshooting

### Common Issues

**Edge Function Returns 500 Error:**
- Check Supabase logs for details
- Verify environment variables are set
- Check database migrations completed

**Comments Not Saving:**
- Verify `system_enabled` config is `true`
- Check RLS policies
- Verify database connection

**Voting Not Working:**
- Check `voting_enabled` config
- Verify user_id format matches
- Check for client-side caching issues

**Discord Bot Not Responding:**
- Verify webhook URL is correct
- Check bot permissions
- Verify interaction endpoint URL

### Getting Help

1. Check Supabase logs
2. Review this documentation
3. Check GitHub Issues
4. Review API reference docs

---

## 📚 Additional Resources

- 📖 **[Complete API Reference](./COMPLETE_API_REFERENCE.md)** - All API endpoints
- 📖 **[Quick Start Guide](./QUICK_START.md)** - Integration guide for apps
- 📖 **[Database Schema](./DATABASE_SCHEMA.md)** - Database structure
- 📖 **[Discord Setup](./DISCORD_SETUP.md)** - Detailed Discord setup
- **Supabase Docs**: https://supabase.com/docs

---

## 🎉 Deployment Complete!

Your Commentum v2 backend API is now ready!

**Next Steps:**
1. ✅ Configure your apps to use the API
2. ✅ Set up moderators and admins
3. ✅ Optional: Configure Discord bot
4. ✅ Start receiving and moderating comments

**Apps can now integrate with your backend:**

```javascript
// Your app can now do this:
const comments = await fetch(
  `https://[your-project].supabase.co/functions/v1/media?media_id=${animeId}&client_type=anilist`
).then(r => r.json());
```

---

## 🔄 What's Next?

### For Backend Maintainers

- Set up monitoring and alerts
- Configure automated backups
- Document custom configurations
- Train moderators

### For App Developers

- Integrate with your app frontend
- Test all API endpoints
- Implement UI for commenting
- Add moderation dashboard (optional)

**Happy Commenting!** 🚀
