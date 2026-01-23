# API Documentation - Commentum v2

Complete API reference for all Commentum v2 endpoints.

## Base URL

```
https://your-project.supabase.co/functions/v1/
```

## Authentication

Most endpoints require authentication using platform-specific tokens:

```json
{
  "client_type": "anilist|myanimelist|simkl|other",
  "user_id": "platform_user_id",
  "token": "platform_auth_token"
}
```

### Platform Authentication Details

#### AniList
- **Token Type**: Bearer token
- **Verification**: GraphQL query to `/viewer`
- **Required Scope**: User profile access

#### MyAnimeList
- **Token Type**: Bearer token
- **Verification**: REST call to `/users/me`
- **Required Scope**: User profile access

#### SIMKL
- **Token Type**: API Key
- **Verification**: REST call to `/users/settings`
- **Required Scope**: User settings access

---

## Comments API

### Endpoint: `/comments`

Handles all comment-related operations.

### Actions

#### 1. Create Comment

**Method**: `POST`

**Authentication**: Not required for basic creation

**Request Body**:
```json
{
  "action": "create",
  "client_type": "anilist",
  "user_id": "12345",
  "media_id": "6789",
  "content": "This was an amazing episode!",
  "parent_id": null
}
```

**Parameters**:
- `action` (required): "create"
- `client_type` (required): Platform identifier
- `user_id` (required): User's platform ID
- `media_id` (required): Media identifier
- `content` (required): Comment text (1-10,000 characters)
- `parent_id` (optional): Integer ID of parent comment for replies

**Response**:
```json
{
  "success": true,
  "comment": {
    "id": 1,
    "client_type": "anilist",
    "user_id": "12345",
    "media_id": "6789",
    "content": "This was an amazing episode!",
    "username": "UserName",
    "user_avatar": "https://example.com/avatar.jpg",
    "media_type": "anime",
    "media_title": "Attack on Titan",
    "media_year": 2023,
    "media_poster": "https://example.com/poster.jpg",
    "parent_id": null,
    "created_at": "2023-12-01T10:00:00Z",
    "updated_at": "2023-12-01T10:00:00Z",
    "upvotes": 0,
    "downvotes": 0,
    "vote_score": 0,
    "user_votes": "{}",
    "deleted": false,
    "pinned": false,
    "locked": false,
    "edited": false,
    "edit_count": 0,
    "user_role": "user"
  }
}
```

**Error Responses**:
- `400`: Missing required fields or invalid content
- `403`: User banned/muted or thread locked
- `404`: User or media not found
- `503`: System disabled

#### 2. Edit Comment

**Method**: `POST`

**Authentication**: Required (token verification)

**Request Body**:
```json
{
  "action": "edit",
  "comment_id": 1,
  "client_type": "anilist",
  "user_id": "12345",
  "token": "user_auth_token",
  "content": "Updated comment text"
}
```

**Parameters**:
- `action` (required): "edit"
- `comment_id` (required): Integer ID of comment to edit
- `client_type` (required): Platform identifier
- `user_id` (required): User's platform ID
- `token` (required): User's auth token
- `content` (required): New comment content

**Response**:
```json
{
  "success": true,
  "comment": {
    "id": 1,
    "content": "Updated comment text",
    "edited": true,
    "edited_at": "2023-12-01T11:00:00Z",
    "edit_count": 1,
    "edit_history": "[{\"oldContent\":\"Original text\",\"newContent\":\"Updated text\",\"editedAt\":\"2023-12-01T11:00:00Z\",\"editedBy\":\"12345\"}]"
  }
}
```

#### 3. Delete Comment

**Method**: `POST`

**Authentication**: Required (token verification)

**Request Body**:
```json
{
  "action": "delete",
  "comment_id": 1,
  "client_type": "anilist",
  "user_id": "12345",
  "token": "user_auth_token"
}
```

**Response**:
```json
{
  "success": true,
  "comment": {
    "id": 1,
    "deleted": true,
    "deleted_at": "2023-12-01T12:00:00Z",
    "deleted_by": "12345"
  }
}
```

---

## Votes API

### Endpoint: `/votes`

Handles comment voting operations.

### Request Body

```json
{
  "comment_id": 1,
  "user_id": "12345",
  "vote_type": "upvote"
}
```

### Parameters

- `comment_id` (required): Integer ID of comment
- `user_id` (required): User's platform ID
- `vote_type` (required): "upvote", "downvote", or "remove"

### Vote Types

#### Upvote
Adds or removes an upvote:
- If no existing vote: Adds upvote
- If existing upvote: Removes vote
- If existing downvote: Changes to upvote

#### Downvote
Adds or removes a downvote:
- If no existing vote: Adds downvote
- If existing downvote: Removes vote
- If existing upvote: Changes to downvote

#### Remove
Removes any existing vote

### Response

```json
{
  "success": true,
  "voteScore": 5,
  "upvotes": 6,
  "downvotes": 1,
  "userVote": "upvote"
}
```

### Error Responses

- `400`: Invalid parameters or vote type
- `403`: Cannot vote on own comment
- `404`: Comment not found
- `503`: Voting system disabled

---

## Reports API

### Endpoint: `/reports`

Handles comment reporting and moderation.

### Actions

#### 1. Create Report

**Request Body**:
```json
{
  "action": "create",
  "comment_id": 1,
  "reporter_id": "12345",
  "reason": "spam",
  "notes": "This looks like automated spam"
}
```

**Parameters**:
- `action` (required): "create"
- `comment_id` (required): Integer ID of comment
- `reporter_id` (required): Reporter's user ID
- `reason` (required): Report reason
- `notes` (optional): Additional context

**Valid Reasons**:
- `spam`
- `offensive`
- `harassment`
- `spoiler`
- `nsfw`
- `off_topic`
- `other`

**Response**:
```json
{
  "success": true,
  "report": {
    "id": "report-1701427200000-abc123def",
    "reporter_id": "12345",
    "reason": "spam",
    "notes": "This looks like automated spam",
    "created_at": "2023-12-01T10:00:00Z",
    "status": "pending"
  },
  "reportCount": 1
}
```

#### 2. Resolve Report

**Authentication**: Required (admin only)

**Request Body**:
```json
{
  "action": "resolve",
  "comment_id": 1,
  "reporter_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "resolution": "resolved",
  "review_notes": "Confirmed spam, removed"
}
```

**Parameters**:
- `action` (required): "resolve"
- `comment_id` (required): Integer ID of comment
- `reporter_id` (required): Original reporter's ID
- `client_type` (required): Platform identifier
- `moderator_id` (required): Moderator's user ID
- `token` (required): Moderator's auth token
- `resolution` (required): "resolved" or "dismissed"
- `review_notes` (optional): Moderator notes

**Response**:
```json
{
  "success": true,
  "report": {
    "id": "report-1701427200000-abc123def",
    "status": "resolved",
    "reviewed_by": "67890",
    "reviewed_at": "2023-12-01T11:00:00Z",
    "review_notes": "Confirmed spam, removed"
  },
  "commentId": 1,
  "newReportStatus": "resolved"
}
```

#### 3. Get Reports Queue

**Authentication**: Required (admin only)

**Request Body**:
```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token"
}
```

**Response**:
```json
{
  "reports": [
    {
      "commentId": 1,
      "content": "Spam content here",
      "author": {
        "id": "12345",
        "username": "Spammer",
        "avatar": "https://example.com/avatar.jpg"
      },
      "media": {
        "id": "6789",
        "title": "Attack on Titan",
        "type": "anime",
        "year": 2023
      },
      "createdAt": "2023-12-01T10:00:00Z",
      "reports": [
        {
          "id": "report-1701427200000-abc123def",
          "reporter_id": "54321",
          "reason": "spam",
          "notes": "Obvious spam",
          "created_at": "2023-12-01T10:00:00Z",
          "status": "pending"
        }
      ],
      "totalReports": 1,
      "reportStatus": "pending"
    }
  ],
  "total": 1
}
```

---

## Moderation API

### Endpoint: `/moderation`

Handles advanced moderation actions.

**Authentication**: Required for all actions (admin only)

### Common Parameters

- `action` (required): Moderation action
- `client_type` (required): Platform identifier
- `moderator_id` (required): Moderator's user ID
- `token` (required): Moderator's auth token

### Actions

#### 1. Pin Comment

**Request Body**:
```json
{
  "action": "pin_comment",
  "comment_id": 1,
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Important announcement"
}
```

**Response**:
```json
{
  "success": true,
  "comment": {
    "id": 1,
    "pinned": true,
    "pinned_at": "2023-12-01T10:00:00Z",
    "pinned_by": "67890"
  },
  "action": "pinned"
}
```

#### 2. Lock Thread

**Request Body**:
```json
{
  "action": "lock_thread",
  "comment_id": 1,
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Off-topic discussion"
}
```

**Response**:
```json
{
  "success": true,
  "comment": {
    "id": 1,
    "locked": true,
    "locked_at": "2023-12-01T10:00:00Z",
    "locked_by": "67890"
  },
  "action": "locked"
}
```

#### 3. Warn User

**Request Body**:
```json
{
  "action": "warn_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Multiple rule violations",
  "severity": "warning",
  "duration": 24
}
```

**Parameters**:
- `target_user_id` (required): User to warn
- `reason` (required): Warning reason
- `severity` (required): "warning", "mute", or "ban"
- `duration` (optional): Duration in hours for mutes

**Response**:
```json
{
  "success": true,
  "action": "warning",
  "targetUserId": "12345",
  "reason": "Multiple rule violations",
  "duration": null
}
```

#### 4. Ban User

**Request Body**:
```json
{
  "action": "ban_user",
  "target_user_id": "12345",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token",
  "reason": "Repeated spam",
  "shadow_ban": false
}
```

**Parameters**:
- `target_user_id` (required): User to ban
- `reason` (required): Ban reason
- `shadow_ban` (optional): `true` for shadow ban, `false` for regular ban

**Response**:
```json
{
  "success": true,
  "action": "banned",
  "targetUserId": "12345",
  "reason": "Repeated spam"
}
```

#### 5. Get Moderation Queue

**Request Body**:
```json
{
  "action": "get_queue",
  "client_type": "anilist",
  "moderator_id": "67890",
  "token": "admin_auth_token"
}
```

**Response**:
```json
{
  "comments": [
    {
      "id": 1,
      "content": "Comment content",
      "reported": true,
      "moderated": true,
      "created_at": "2023-12-01T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

## Media API

### Endpoint: `/media`

Retrieves comments for specific media with pagination and sorting.

### Method: `GET`

### Query Parameters

- `media_id` (required): Media identifier
- `client_type` (required): Platform identifier
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 50, max: 100)
- `sort` (optional): Sort order (default: "newest")

### Sort Options

- `newest`: Most recent first
- `oldest`: Oldest first
- `top`: Highest vote score first
- `controversial`: Most upvotes first

### Example Request

```
GET /media?media_id=6789&client_type=anilist&page=1&limit=20&sort=top
```

### Response

```json
{
  "media": {
    "mediaId": "6789",
    "mediaType": "anime",
    "mediaTitle": "Attack on Titan",
    "mediaYear": 2023,
    "mediaPoster": "https://example.com/poster.jpg"
  },
  "comments": [
    {
      "id": 1,
      "content": "Great episode!",
      "username": "User123",
      "user_avatar": "https://example.com/avatar.jpg",
      "user_role": "user",
      "created_at": "2023-12-01T10:00:00Z",
      "upvotes": 10,
      "downvotes": 2,
      "vote_score": 8,
      "pinned": false,
      "locked": false,
      "edited": false,
      "replies": [
        {
          "id": 2,
          "content": "I agree!",
          "username": "User456",
          "created_at": "2023-12-01T10:30:00Z",
          "upvotes": 3,
          "downvotes": 0,
          "vote_score": 3,
          "replies": []
        }
      ]
    }
  ],
  "stats": {
    "commentCount": 150,
    "totalUpvotes": 500,
    "totalDownvotes": 50,
    "netScore": 450
  },
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Error description"
}
```

### Common HTTP Status Codes

- `200`: Success
- `201`: Created (for new resources)
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (authentication required/failed)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `500`: Internal Server Error
- `503`: Service Unavailable (system disabled)

### Rate Limiting

All endpoints are subject to rate limiting configured in the system:
- Comments: 30 per hour per user
- Votes: 100 per hour per user
- Reports: 10 per hour per user

When rate limited, returns `429 Too Many Requests`.

---

## CORS Headers

All endpoints include CORS headers:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: content-type
```

---

## Testing

Use the provided project URL for testing:
```
https://lvyelpikusmxhobjragw.supabase.co
```

Replace `your-project` in the base URL with the actual project name for production use.