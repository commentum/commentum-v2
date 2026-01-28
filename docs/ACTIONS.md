# System Actions and Capabilities - Commentum v2

Complete reference of all available actions, capabilities, and features in the Commentum v2 system.

## 🎯 Overview

Commentum v2 provides a comprehensive comment system with advanced moderation, voting, and reporting capabilities. This document outlines all possible actions and system features.

## 📝 Comment Actions

### Core Comment Operations

#### Create Comment
- **Endpoint**: `/comments` with `action: "create"`
- **Purpose**: Add new comment to media
- **Features**:
  - Auto-fetch user and media information
  - Support for nested replies
  - Content validation and filtering
  - Banned keyword detection
  - Rate limiting enforcement

#### Edit Comment
- **Endpoint**: `/comments` with `action: "edit"`
- **Purpose**: Modify existing comment
- **Features**:
  - Full edit history tracking
  - Edit count and timestamps
  - Permission validation (owner or moderator)
  - Audit logging

#### Delete Comment
- **Endpoint**: `/comments` with `action: "delete"`
- **Purpose**: Soft delete comment
- **Features**:
  - Soft delete (content preserved)
  - Delete tracking (who, when)
  - Permission validation
  - Thread preservation for replies

### Comment Retrieval

#### Get Media Comments
- **Endpoint**: `/media` with GET parameters
- **Purpose**: Retrieve comments for specific media
- **Features**:
  - Pagination support
  - Multiple sorting options
  - Nested comment structure
  - Media statistics
  - Banned/shadow-banned content filtering

**Sorting Options**:
- `newest`: Most recent first
- `oldest`: Oldest first
- `top`: Highest vote score
- `controversial`: Most upvotes

## 🗳️ Voting Actions

### Vote Operations
- **Endpoint**: `/votes`
- **Purpose**: Manage comment voting
- **Vote Types**:
  - `upvote`: Add or remove upvote
  - `downvote`: Add or remove downvote
  - `remove`: Remove any existing vote

### Voting Features
- **Vote Switching**: Change from upvote to downvote
- **Self-Vote Prevention**: Cannot vote on own comments
- **Real-time Scoring**: Automatic vote score calculation
- **Vote Tracking**: Complete vote history per comment
- **Rate Limiting**: 100 votes per hour per user

### Vote Data Structure
```json
{
  "user_votes": {
    "user123": "upvote",
    "user456": "downvote"
  },
  "upvotes": 10,
  "downvotes": 2,
  "vote_score": 8
}
```

## 🚨 Reporting Actions

### Report Operations
- **Endpoint**: `/reports`

#### Create Report
- **Action**: `"create"`
- **Purpose**: Report inappropriate content
- **Report Reasons**:
  - `spam`: Unsolicited promotional content
  - `offensive`: Offensive language or content
  - `harassment`: Targeted harassment
  - `spoiler`: Unmarked spoilers
  - `nsfw`: Not safe for work content
  - `off_topic`: Irrelevant content
  - `other`: Other violations

#### Resolve Report
- **Action**: `"resolve"`
- **Purpose**: Moderator resolves reported content
- **Resolutions**:
  - `resolved`: Action taken on report
  - `dismissed`: Report rejected

#### Get Reports Queue
- **Action**: `"get_queue"`
- **Purpose**: View pending reports
- **Features**:
  - Admin-only access
  - Paginated results
  - Complete report details
  - Comment context

### Reporting Features
- **Duplicate Prevention**: One report per user per comment
- **Report Tracking**: Complete audit trail
- **Status Management**: Pending → Reviewed → Resolved/Dismissed
- **Moderator Notes**: Private notes for resolution context

## 🔧 Moderation Actions

### Moderation Operations
- **Endpoint**: `/moderation`
- **Authentication**: Admin token required for all actions

### Comment Moderation

#### Pin/Unpin Comment
- **Actions**: `"pin_comment"`, `"unpin_comment"`
- **Purpose**: Highlight important comments
- **Features**:
  - Pin tracking (who, when, why)
  - Automatic unpinning option
  - Visual distinction in UI

#### Lock/Unlock Thread
- **Actions**: `"lock_thread"`, `"unlock_thread"`
- **Purpose**: Prevent further replies
- **Features**:
  - Thread-level locking
  - Lock tracking and reasoning
  - Prevents new replies only

### User Moderation

#### Warn User
- **Action**: `"warn_user"`
- **Purpose**: Issue warning to user
- **Severity Levels**:
  - `warning`: Simple warning
  - `mute`: Temporary posting restriction
  - `ban`: Permanent ban (admin only)

- **Features**:
  - Warning count tracking
  - Temporary mutes with duration
  - Automatic threshold enforcement
  - Moderation audit trail

#### Ban/Unban User
- **Actions**: `"ban_user"`, `"unban_user"`
- **Purpose**: Manage user access
- **Ban Types**:
  - Regular ban: Visible to user
  - Shadow ban: Invisible to user
- **Permissions**: Admin and super-admin only

### Moderation Features
- **Role Hierarchy**: Super Admin > Admin > Moderator > User
- **Permission Validation**: Cannot moderate equal/higher roles
- **Audit Logging**: Complete action tracking
- **Bulk Operations**: Apply actions across all user comments

## 🔐 Authentication Actions

### Platform Authentication
- **AniList**: Bearer token verification via GraphQL
- **MyAnimeList**: Bearer token verification via REST
- **SIMKL**: API key verification via REST
- **Other**: Basic user identification

### Authentication Features
- **Token Validation**: Verify token authenticity
- **User Identity**: Confirm user ID matches token
- **Role Verification**: Check user permissions
- **Admin Access**: Special token verification for moderators

### Role-Based Access Control
- **User**: Create, edit own comments, vote, report
- **Moderator**: All user actions + moderate content
- **Admin**: All moderator actions + user management
- **Super Admin**: Full system access

## 🛡️ Security Actions

### Content Filtering
- **Banned Keywords**: Automatic content rejection
- **Content Length**: 1-10,000 character limits
- **Rate Limiting**: Per-user action limits
- **Self-Action Prevention**: Cannot vote/report own content

### User Status Management
- **Warnings**: Track rule violations
- **Muting**: Temporary posting restrictions
- **Banning**: Permanent access removal
- **Shadow Banning**: Hidden content removal

### System Security
- **IP Tracking**: Store user IP addresses
- **User Agent Logging**: Browser/client tracking
- **Audit Trails**: Complete action logging
- **RLS Policies**: Database-level access control

## 📊 System Configuration Actions

### Configuration Management
- **Table**: `config`
- **Access**: Admin and super-admin only
- **Format**: JSON values for complex data

### Configurable Settings

#### System Controls
- `system_enabled`: Master system toggle
- `voting_enabled`: Voting system toggle
- `reporting_enabled`: Reporting system toggle

#### Content Limits
- `max_comment_length`: Maximum comment characters
- `max_nesting_level`: Maximum reply depth

#### Rate Limits
- `rate_limit_comments_per_hour`: Comment creation limit
- `rate_limit_votes_per_hour`: Voting limit
- `rate_limit_reports_per_hour`: Reporting limit

#### Moderation Thresholds
- `auto_warn_threshold`: Auto-warn at X warnings
- `auto_mute_threshold`: Auto-mute at X warnings
- `auto_ban_threshold`: Auto-ban at X warnings

#### User Management
- `super_admin_users`: JSON array of super admin IDs
- `admin_users`: JSON array of admin IDs
- `moderator_users`: JSON array of moderator IDs

#### Content Moderation
- `banned_keywords`: JSON array of prohibited words

#### Platform Integration
- `anilist_client_id`: AniList API client ID
- `myanimelist_client_id`: MyAnimeList client ID
- `simkl_client_id`: SIMKL API key

## 🔄 Automated Actions

### Triggers and Automation

#### Database Triggers
- **Updated At**: Automatic timestamp updates
- **Comment Counting**: Real-time statistics
- **Vote Score Calculation**: Automatic score updates

#### Automated Moderation
- **Threshold Enforcement**: Auto-warn/mute/ban
- **Content Filtering**: Keyword-based rejection
- **Rate Limiting**: Automatic action blocking

#### Data Cleanup
- **Edit History**: Automatic history management
- **Report Status**: Automatic status updates
- **User Status**: Consistent status across comments

## 📈 Analytics and Reporting

### System Statistics
- **Comment Metrics**: Total, active, deleted counts
- **User Activity**: Posting frequency, engagement
- **Moderation Actions**: Reports, bans, warnings
- **Performance Metrics**: Response times, error rates

### Available Reports
- **Comment Growth**: Daily/weekly comment trends
- **User Engagement**: Voting and participation
- **Moderation Load**: Report resolution times
- **Content Quality**: Edit rates, deletion reasons

## 🚀 Performance Actions

### Optimization Features
- **Database Indexing**: Optimized query performance
- **Pagination**: Large dataset handling
- **JSON Operations**: Efficient JSON data handling
- **Caching**: Configuration and frequently accessed data

### Scaling Capabilities
- **Horizontal Scaling**: Multiple edge function instances
- **Database Scaling**: Read replicas and connection pooling
- **CDN Integration**: Static asset delivery
- **Load Balancing**: Automatic request distribution

## 🎛️ Administrative Actions

### System Administration
- **Configuration Updates**: Real-time setting changes
- **User Role Management**: Dynamic role assignment
- **Content Moderation**: Bulk operations
- **System Monitoring**: Health checks and alerts

### Data Management
- **Backup Operations**: Automated and manual backups
- **Data Export**: Comment and configuration export
- **Archive Management**: Old data handling
- **System Restore**: Point-in-time recovery

## 🔍 Monitoring and Debugging

### Logging Actions
- **Function Logs**: Real-time execution logs
- **Error Tracking**: Detailed error information
- **Performance Metrics**: Response time tracking
- **User Actions**: Complete audit trail

### Debugging Features
- **Verbose Logging**: Detailed execution information
- **Test Endpoints**: Development and testing tools
- **Status Pages**: System health monitoring
- **Error Reports**: Automated error notifications

---

## 🎯 Action Matrix

| Action | Endpoint | Auth Required | Admin Only | Description |
|--------|----------|---------------|------------|-------------|
| create | /comments | ❌ | ❌ | Create new comment |
| edit | /comments | ✅ | ❌ | Edit own comment |
| delete | /comments | ✅ | ❌ | Delete own comment |
| vote | /votes | ❌ | ❌ | Vote on comment |
| create_report | /reports | ❌ | ❌ | Report comment |
| resolve_report | /reports | ✅ | ✅ | Resolve report |
| get_queue | /reports | ✅ | ✅ | View reports |
| pin_comment | /moderation | ✅ | ✅ | Pin comment |
| lock_thread | /moderation | ✅ | ✅ | Lock thread |
| warn_user | /moderation | ✅ | ✅ | Warn user |
| ban_user | /moderation | ✅ | ✅ | Ban user |
| get_media | /media | ❌ | ❌ | Get comments |

This comprehensive action set provides a full-featured comment system with enterprise-grade moderation and security capabilities.