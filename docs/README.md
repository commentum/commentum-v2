# Documentation Overview - Commentum v2

Welcome to the comprehensive documentation for Commentum v2, an advanced comment system built on Supabase Edge Functions.

## 📚 Available Documentation

### 🚀 [README.md](../README.md)
**Getting Started Guide**
- Project overview and features
- Quick start instructions
- Architecture summary
- Use cases and examples
- Support links

**Perfect for**: New users, developers evaluating the system

---

### 🔌 [API Documentation](./API.md)
**Complete API Reference**
- All endpoint documentation
- Request/response examples
- Authentication methods
- Error handling
- Rate limiting information

**Perfect for**: Frontend developers, API integrators

---

### 🗄️ [Database Schema](./DATABASE_SCHEMA.md)
**Database Design Reference**
- Complete table structures
- Column descriptions and constraints
- Indexes and performance optimization
- RLS policies and security
- Migration notes

**Perfect for**: Database administrators, backend developers

---

### 🚀 [Deployment Guide](./DEPLOYMENT.md)
**Production Setup Instructions**
- Development environment setup
- Production deployment steps
- Configuration management
- Environment variables
- Monitoring and troubleshooting

**Perfect for**: DevOps engineers, system administrators

---

## 🎯 Quick Navigation

### For Frontend Developers
1. Start with [README.md](../README.md) to understand the system
2. Review [API Documentation](./API.md) for integration details
3. Test with the provided example URLs

### For Backend Developers
1. Read [Database Schema](./DATABASE_SCHEMA.md) for data structure
2. Review [API Documentation](./API.md) for endpoint logic
3. Check [Deployment Guide](./DEPLOYMENT.md) for setup

### For System Administrators
1. Follow [Deployment Guide](./DEPLOYMENT.md) for setup
2. Review [Database Schema](./DATABASE_SCHEMA.md) for maintenance
3. Monitor using the provided queries

## 🔧 System Components

### Edge Functions
- **comments**: Comment CRUD operations
- **votes**: Voting system management
- **reports**: Reporting and moderation
- **moderation**: Advanced moderation tools
- **media**: Media comment retrieval
- **shared**: Common utilities

### Database Tables
- **comments**: Main comment storage
- **config**: System configuration

### Supported Platforms
- **AniList**: GraphQL API integration
- **MyAnimeList**: REST API integration
- **SIMKL**: REST API integration
- **Other**: Custom platform support

## 🌐 Live Demo

**URL**: https://lvyelpikusmxhobjragw.supabase.co

This is the live production instance where you can test all features and API endpoints.

## 📋 Feature Checklist

### Core Features
- ✅ Multi-platform user authentication
- ✅ Nested comment threads
- ✅ Real-time voting system
- ✅ Advanced moderation tools
- ✅ Content reporting system
- ✅ User role management
- ✅ Rate limiting
- ✅ Content filtering

### Security Features
- ✅ Token-based authentication
- ✅ Row Level Security (RLS)
- ✅ IP and user agent tracking
- ✅ Banned keyword filtering
- ✅ Shadow banning
- ✅ Audit logging

### Performance Features
- ✅ Optimized database indexes
- ✅ Pagination support
- ✅ Efficient JSON operations
- ✅ Caching strategies
- ✅ CDN-ready responses

## 🛠️ Development Workflow

### 1. Setup
```bash
git clone https://github.com/commentum/commentum-v2.git
cd commentum-v2
supabase start
supabase db push
```

### 2. Development
```bash
# Deploy locally
supabase functions deploy .

# Test endpoints
curl http://localhost:54321/functions/v1/comments
```

### 3. Production
```bash
# Link to project
supabase link --project-ref your-project

# Deploy to production
supabase functions deploy .
```

## 🔍 Key Configuration

### Essential Settings
- `system_enabled`: Master toggle
- `voting_enabled`: Voting system toggle
- `reporting_enabled`: Reporting system toggle
- `max_comment_length`: Content limit (default: 10000)
- `max_nesting_level`: Reply depth (default: 10)

### Rate Limits
- Comments: 30/hour per user
- Votes: 100/hour per user
- Reports: 10/hour per user

### User Roles
- **user**: Basic commenting permissions
- **moderator**: Can moderate content
- **admin**: Full administrative access
- **super_admin**: System-wide access

## 🚨 Important Notes

### Security
- Never expose `SUPABASE_SERVICE_ROLE_KEY` client-side
- Use environment variables for all secrets
- Enable RLS on all tables
- Monitor function logs regularly

### Performance
- Monitor database query performance
- Use pagination for large comment threads
- Cache frequently accessed configuration
- Archive old deleted comments

### Maintenance
- Regular backup of configuration
- Update banned keywords periodically
- Review user roles and permissions
- Monitor system health metrics

## 📞 Support

### Documentation Issues
- Report documentation bugs via GitHub Issues
- Suggest improvements via pull requests
- Request new topics via GitHub Discussions

### Technical Support
- **GitHub Issues**: Report bugs and request features
- **Discord Community**: Join for discussions and help
- **Supabase Docs**: For platform-specific questions

### Contributing
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

---

**Commentum v2** - Building better communities, one comment at a time.

For the most up-to-date information, always check the main repository: https://github.com/commentum/commentum-v2