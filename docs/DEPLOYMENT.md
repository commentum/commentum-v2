# Deployment and Setup Guide - Commentum v2

Complete guide for deploying and configuring Commentum v2 in production and development environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Development Setup](#development-setup)
3. [Production Deployment](#production-deployment)
4. [Configuration](#configuration)
5. [Environment Variables](#environment-variables)
6. [Database Setup](#database-setup)
7. [Edge Functions Deployment](#edge-functions-deployment)
8. [Testing and Validation](#testing-and-validation)
9. [Monitoring and Maintenance](#monitoring-and-maintenance)
10. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Accounts and Services

1. **Supabase Account**
   - Create account at [supabase.com](https://supabase.com)
   - Create new project or use existing

2. **Platform API Credentials** (Optional but recommended)
   - **AniList**: Create application at [AniList](https://anilist.co/settings/developer)
   - **MyAnimeList**: Register application at [MyAnimeList](https://myanimelist.net/apiconfig)
   - **SIMKL**: Get API key at [SIMKL](https://simkl.com/developers/apikey/)

### Required Tools

```bash
# Install Supabase CLI
npm install -g supabase

# Or using other package managers
curl -L https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar xz
sudo mv supabase /usr/local/bin/

# Verify installation
supabase --version
```

### System Requirements

- **Node.js**: 16+ (for local development)
- **Git**: For version control
- **Terminal/CLI**: For command-line operations

## Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/commentum/commentum-v2.git
cd commentum-v2
```

### 2. Initialize Local Supabase

```bash
# Start local Supabase stack
supabase start

# This will start:
# - PostgreSQL database
# - Supabase Studio (localhost:54323)
# - API endpoint (localhost:54321)
# - Edge Functions runtime (localhost:54324)
```

### 3. Apply Database Migrations

```bash
# Apply the schema to local database
supabase db push

# Verify schema
supabase db shell
\dt
```

### 4. Set Up Local Environment

Create `.env` file in project root:

```bash
# Local Supabase configuration
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_ROLE_KEY=your_local_service_role_key
SUPABASE_ANON_KEY=your_local_anon_key

# Platform API keys (optional)
MYANIMELIST_CLIENT_ID=your_mal_client_id
SIMKL_CLIENT_ID=your_simkl_client_id
```

Get the local keys from:
```bash
supabase status
```

### 5. Deploy Edge Functions Locally

```bash
# Deploy all functions to local runtime
supabase functions deploy .

# Or deploy specific functions
supabase functions deploy comments
supabase functions deploy votes
supabase functions deploy reports
supabase functions deploy moderation
supabase functions deploy media
```

### 6. Test Local Setup

```bash
# Test comments endpoint
curl -X POST http://localhost:54321/functions/v1/comments \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "other",
    "user_id": "test_user",
    "media_id": "test_media",
    "content": "Test comment"
  }'
```

## Production Deployment

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose organization and region
4. Set database password
5. Wait for project creation

### 2. Link to Remote Project

```bash
# Link to your remote project
supabase link --project-ref your-project-ref

# Get project ref from Supabase dashboard URL:
# https://supabase.com/dashboard/project/your-project-ref
```

### 3. Deploy Database Schema

```bash
# Push schema to production
supabase db push

# Or use migration files for production
supabase migration up
```

### 4. Set Production Environment Variables

In Supabase Dashboard:

1. Go to **Settings** > **Edge Functions**
2. Add environment variables:

```bash
# Required
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional platform APIs
MYANIMELIST_CLIENT_ID=your_production_mal_client_id
SIMKL_CLIENT_ID=your_production_simkl_client_id
```

### 5. Deploy Edge Functions to Production

```bash
# Deploy all functions
supabase functions deploy .

# Deploy without confirmation (for CI/CD)
supabase functions deploy . --no-verify-jwt
```

### 6. Configure Production Settings

Connect to your database and update configuration:

```sql
-- Update system settings
UPDATE config SET value = 'true' WHERE key = 'system_enabled';
UPDATE config SET value = 'true' WHERE key = 'voting_enabled';
UPDATE config SET value = 'true' WHERE key = 'reporting_enabled';

-- Add admin users (replace with actual user IDs)
UPDATE config SET value = '["your_admin_user_id"]' WHERE key = 'admin_users';

-- Set rate limits for production
UPDATE config SET value = '30' WHERE key = 'rate_limit_comments_per_hour';
UPDATE config SET value = '100' WHERE key = 'rate_limit_votes_per_hour';
UPDATE config SET value = '10' WHERE key = 'rate_limit_reports_per_hour';
```

## Configuration

### System Configuration

Access via Supabase Studio > Table Editor > config

#### Essential Settings

```sql
-- Basic system settings
UPDATE config SET value = '10000' WHERE key = 'max_comment_length';
UPDATE config SET value = '10' WHERE key = 'max_nesting_level';

-- Rate limiting (adjust based on your traffic)
UPDATE config SET value = '30' WHERE key = 'rate_limit_comments_per_hour';
UPDATE config SET value = '100' WHERE key = 'rate_limit_votes_per_hour';
UPDATE config SET value = '10' WHERE key = 'rate_limit_reports_per_hour';

-- Auto-moderation thresholds
UPDATE config SET value = '3' WHERE key = 'auto_warn_threshold';
UPDATE config SET value = '5' WHERE key = 'auto_mute_threshold';
UPDATE config SET value = '10' WHERE key = 'auto_ban_threshold';
```

#### User Role Management

```sql
-- Add super admin
UPDATE config SET value = '["super_admin_user_id"]' WHERE key = 'super_admin_users';

-- Add admins
UPDATE config SET value = '["admin_user_id_1", "admin_user_id_2"]' WHERE key = 'admin_users';

-- Add moderators
UPDATE config SET value = '["mod_user_id_1", "mod_user_id_2"]' WHERE key = 'moderator_users';
```

#### Content Moderation

```sql
-- Add banned keywords
UPDATE config SET value = '["spam", "offensive", "inappropriate"]' WHERE key = 'banned_keywords';
```

### Platform API Configuration

#### AniList Setup

1. Visit [AniList Developer](https://anilist.co/settings/developer)
2. Create new application
3. Get Client ID (no client secret needed for public apps)
4. Update config:

```sql
UPDATE config SET value = 'your_anilist_client_id' WHERE key = 'anilist_client_id';
```

#### MyAnimeList Setup

1. Visit [MyAnimeList API](https://myanimelist.net/apiconfig)
2. Create new application
3. Get Client ID
4. Set environment variable in Supabase Dashboard:
   - `MYANIMELIST_CLIENT_ID=your_client_id`

#### SIMKL Setup

1. Visit [SIMKL Developers](https://simkl.com/developers/apikey/)
2. Get API key
3. Set environment variable in Supabase Dashboard:
   - `SIMKL_CLIENT_ID=your_simkl_key`

## Environment Variables

### Required Variables

| Variable | Description | Source |
|----------|-------------|--------|
| `SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key | Supabase Dashboard |

### Optional Variables

| Variable | Description | Platform |
|----------|-------------|----------|
| `MYANIMELIST_CLIENT_ID` | MyAnimeList API client ID | MyAnimeList |
| `SIMKL_CLIENT_ID` | SIMKL API key | SIMKL |

### Security Notes

- **Never expose** `SUPABASE_SERVICE_ROLE_KEY` on client side
- Use **environment variables** for all sensitive data
- **Rotate keys** periodically for security
- **Use different keys** for development and production

## Database Setup

### Initial Migration

```bash
# Apply schema to new database
supabase db push

# Verify tables exist
supabase db shell -c "\dt"
```

### Data Seeding

```sql
-- Insert default configuration (already handled by migration)
-- Verify config exists
SELECT * FROM config;

-- Test with a sample comment
INSERT INTO comments (
    client_type, user_id, media_id, content, 
    username, media_type, media_title
) VALUES (
    'other', 'test_user', 'test_media', 'Test comment',
    'TestUser', 'other', 'Test Media'
);
```

### Backup Strategy

```bash
# Manual backup
supabase db dump > backup_$(date +%Y%m%d).sql

# Automated backups (enabled by default)
# Check in Supabase Dashboard > Settings > Database
```

## Edge Functions Deployment

### Individual Function Deployment

```bash
# Deploy specific function
supabase functions deploy comments

# Deploy with custom secrets
supabase functions deploy comments --env-file .env.production
```

### Batch Deployment

```bash
# Deploy all functions
supabase functions deploy .

# Verify deployment
supabase functions list
```

### Function URLs

After deployment, functions are available at:
```
https://your-project-ref.supabase.co/functions/v1/{function-name}
```

Examples:
- Comments: `https://your-project-ref.supabase.co/functions/v1/comments`
- Votes: `https://your-project-ref.supabase.co/functions/v1/votes`
- Reports: `https://your-project-ref.supabase.co/functions/v1/reports`

## Testing and Validation

### Health Check

```bash
# Test basic connectivity
curl https://your-project-ref.supabase.co/functions/v1/comments

# Should return CORS headers for OPTIONS request
curl -X OPTIONS https://your-project-ref.supabase.co/functions/v1/comments
```

### Functional Testing

```bash
# Test comment creation
curl -X POST https://your-project-ref.supabase.co/functions/v1/comments \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "client_type": "other",
    "user_id": "test_user",
    "media_id": "test_media",
    "content": "Production test comment"
  }'
```

### Load Testing

```bash
# Using Apache Bench (install with: apt-get install apache2-utils)
ab -n 100 -c 10 https://your-project-ref.supabase.co/functions/v1/media?media_id=test&client_type=other

# Monitor function logs in Supabase Dashboard
```

## Monitoring and Maintenance

### Log Monitoring

1. **Supabase Dashboard**: Edge Functions > Logs
2. **Real-time logs**: View live function invocations
3. **Error tracking**: Monitor 4xx/5xx responses

### Performance Monitoring

```sql
-- Monitor comment growth
SELECT 
    DATE(created_at) as date,
    COUNT(*) as comment_count
FROM comments 
GROUP BY DATE(created_at) 
ORDER BY date DESC 
LIMIT 30;

-- Monitor report activity
SELECT 
    report_status,
    COUNT(*) as count
FROM comments 
WHERE reported = true 
GROUP BY report_status;
```

### Database Maintenance

```sql
-- Update statistics
ANALYZE comments;

-- Reindex if needed
REINDEX INDEX CONCURRENTLY idx_comments_created;

-- Archive old deleted comments (optional)
CREATE TABLE comments_archive AS 
SELECT * FROM comments 
WHERE deleted = true 
AND deleted_at < NOW() - INTERVAL '90 days';
```

### Regular Tasks

1. **Daily**: Check error logs and performance metrics
2. **Weekly**: Review user reports and moderation queue
3. **Monthly**: Update banned keywords and rate limits
4. **Quarterly**: Review and rotate API keys

## Troubleshooting

### Common Issues

#### 1. Function Deployment Fails

```bash
# Check function syntax
deno check supabase/functions/comments/index.ts

# Check dependencies
supabase functions serve --no-verify-jwt
```

#### 2. Database Connection Issues

```bash
# Check database status
supabase status

# Test connection
supabase db shell -c "SELECT 1;"
```

#### 3. CORS Errors

```bash
# Verify CORS headers in function
# All functions should include:
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
}
```

#### 4. Authentication Failures

```bash
# Check environment variables
supabase secrets list

# Verify API keys are correctly set
# Test with known good tokens
```

#### 5. Rate Limiting Issues

```sql
-- Check current rate limits
SELECT * FROM config WHERE key LIKE 'rate_limit_%';

-- Temporarily disable for testing
UPDATE config SET value = '1000' WHERE key LIKE 'rate_limit_%';
```

### Debug Mode

Enable debug logging by updating function:

```typescript
// Add to function for debugging
console.log('Debug info:', { userId, action, timestamp: new Date() })
```

### Getting Help

1. **Supabase Documentation**: [docs.supabase.com](https://docs.supabase.com)
2. **GitHub Issues**: Report bugs in the repository
3. **Community**: Join Supabase Discord community
4. **Status Page**: Check [status.supabase.com](https://status.supabase.com)

## Production Checklist

### Pre-deployment

- [ ] All environment variables set
- [ ] Database schema applied
- [ ] Rate limits configured appropriately
- [ ] Admin users configured
- [ ] Banned keywords updated
- [ ] API keys tested

### Post-deployment

- [ ] Functions deployed successfully
- [ ] CORS headers working
- [ ] Authentication working
- [ ] Basic functionality tested
- [ ] Monitoring configured
- [ ] Backup strategy confirmed

### Security Review

- [ ] Service role key secured
- [ ] No secrets in code
- [ ] RLS policies enabled
- [ ] Rate limits active
- [ ] API permissions minimal

---

Your Commentum v2 system is now ready for production use! For the live example, visit: https://lvyelpikusmxhobjragw.supabase.co