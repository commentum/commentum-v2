# Commentum v2 - Advanced Comment System

A powerful, feature-rich comment system built on Supabase Edge Functions with support for multiple media platforms, advanced moderation, voting, and reporting capabilities.

## 🚀 Features

### Core Functionality
- **Multi-Platform Support**: AniList, MyAnimeList, SIMKL, and custom platforms
- **Nested Comments**: Configurable nesting levels for threaded discussions
- **Real-time Voting**: Upvote/downvote system with vote tracking
- **Advanced Moderation**: Pin, lock, warn, ban, and shadow-ban capabilities
- **Reporting System**: User-driven content reporting with moderation queue
- **Rich Media Integration**: Automatic fetching of user and media information
- **Role-Based Access**: User, Moderator, Admin, and Super Admin roles

### Security & Moderation
- **Token Authentication**: Secure API token verification for all platforms
- **Content Filtering**: Banned keyword detection and filtering
- **User Status Management**: Ban, mute, shadow-ban, and warning system
- **Edit History**: Complete audit trail for comment modifications
- **IP & User Agent Tracking**: Enhanced security monitoring

### Performance & Scalability
- **Optimized Database**: Efficient indexing and query optimization
- **Pagination**: Configurable page sizes for large comment threads
- **Caching**: Built-in caching for frequently accessed data
- **Rate Limiting**: Configurable rate limits for all actions

## 🏗️ Architecture

### Database Schema
- **comments**: Main table storing all comment data and metadata
- **config**: System configuration and settings storage

### Edge Functions
- **comments**: Comment CRUD operations (create, edit, delete)
- **votes**: Voting system management
- **reports**: Reporting and moderation queue
- **moderation**: Advanced moderation actions
- **media**: Media comment retrieval and pagination
- **shared**: Common utilities and authentication

### Supported Platforms
- **AniList**: GraphQL API integration
- **MyAnimeList**: REST API integration  
- **SIMKL**: REST API integration
- **Other**: Custom platform support

## 📦 Installation

### Prerequisites
- Supabase account and project
- Node.js 16+ (for local development)
- API credentials for supported platforms

### Setup Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/commentum/commentum-v2.git
   cd commentum-v2
   ```

2. **Set up Supabase**
   ```bash
   # Apply database migrations
   supabase db push
   
   # Deploy edge functions
   supabase functions deploy .
   ```

3. **Configure Environment Variables**
   ```bash
   # In Supabase Dashboard > Settings > Edge Functions
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   # Optional: Platform API keys
   MYANIMELIST_CLIENT_ID=your_mal_client_id
   SIMKL_CLIENT_ID=your_simkl_client_id
   ```

4. **Configure System Settings**
   The system automatically populates default configuration in the `config` table. Update as needed:
   - Rate limits
   - User roles
   - Banned keywords
   - System toggles

## 🔧 Configuration

### System Configuration
All configuration is stored in the `config` table:

```sql
-- Example configuration updates
UPDATE config SET value = '50' WHERE key = 'max_comment_length';
UPDATE config SET value = '[123, 456]' WHERE key = 'moderator_users';
UPDATE config SET value = '["spam", "offensive"]' WHERE key = 'banned_keywords';
```

### Key Configuration Options
- `max_comment_length`: Maximum comment character limit (default: 10000)
- `max_nesting_level`: Maximum reply nesting depth (default: 10)
- `rate_limit_*`: Rate limits per hour for various actions
- `*_users`: JSON arrays of user IDs for each role
- `system_enabled`: Master toggle for the entire system
- `voting_enabled`: Toggle for voting system
- `reporting_enabled`: Toggle for reporting system

## 📚 API Documentation

### Base URL
```
https://your-project.supabase.co/functions/v1/
```

### Authentication
Most endpoints require platform-specific authentication:
```json
{
  "client_type": "anilist|myanimelist|simkl|other",
  "user_id": "platform_user_id",
  "token": "platform_auth_token"
}
```

### Core Endpoints

#### Comments API
**Endpoint**: `/comments`

**Actions**:
- `create`: Create new comment
- `edit`: Edit existing comment  
- `delete`: Soft delete comment

**Example Request**:
```json
{
  "action": "create",
  "client_type": "anilist",
  "user_id": "12345",
  "media_id": "6789",
  "content": "Great episode!",
  "parent_id": null
}
```

#### Votes API
**Endpoint**: `/votes`

**Parameters**:
- `comment_id`: Integer ID of comment
- `user_id`: User's platform ID
- `vote_type`: "upvote", "downvote", or "remove"

#### Reports API
**Endpoint**: `/reports`

**Actions**:
- `create`: Report a comment
- `resolve`: Resolve a report (admin only)
- `get_queue`: Get moderation queue (admin only)

#### Moderation API
**Endpoint**: `/moderation`

**Actions**:
- `pin_comment`/`unpin_comment`
- `lock_thread`/`unlock_thread`
- `warn_user`
- `ban_user`/`unban_user`
- `get_queue`

#### Media API
**Endpoint**: `/media`

**Parameters**:
- `media_id`: Media identifier
- `client_type`: Platform type
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 50)
- `sort`: "newest", "oldest", "top", "controversial"

## 🔒 Security Features

### Authentication & Authorization
- Platform-specific token verification
- Role-based access control
- Permission hierarchy enforcement

### Content Protection
- Banned keyword filtering
- Rate limiting per user
- Self-action prevention (no self-voting, self-reporting)

### User Management
- Warning system with thresholds
- Temporary muting
- Permanent and shadow banning
- Audit logging for all actions

## 🎯 Use Cases

### Media Discussion Platforms
- Anime/manga review sites
- Movie discussion forums
- TV show episode comments

### Community Features
- Blog comment sections
- Product review systems
- Social media platforms

### Moderation Workflows
- Community management
- Content moderation
- User behavior management

## 🚀 Deployment

### Production Deployment
1. Configure all environment variables
2. Apply database migrations
3. Deploy edge functions
4. Test all API endpoints
5. Configure monitoring

### Monitoring & Maintenance
- Monitor function logs in Supabase Dashboard
- Track database performance
- Regular backup of configuration
- Update banned keywords as needed

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

- **Documentation**: See `/docs` folder for detailed API documentation
- **Issues**: Report bugs via GitHub Issues
- **Community**: Join our Discord server for discussions

## 🔗 Related Links

- **Live Demo**: https://whzwmfxngelicmjyxwmr.supabase.co
- **Supabase**: https://supabase.com
- **AniList API**: https://anilist.gitbook.io/anilist-apiv2-docs/
- **MyAnimeList API**: https://myanimelist.net/apiconfig/references/api/v2
- **SIMKL API**: https://simkl.docs.apiary.io/

---

**Commentum v2** - Building better communities, one comment at a time.
