// User and media information validation utilities
// Frontend is responsible for providing all user and media information
// Backend just stores the data as provided without validation

export interface UserInfo {
  user_id: string;
  username: string;
  avatar?: string;
}

export interface MediaInfo {
  media_id: string;
  type: string; // Any string from frontend (anime, manga, movie, tv-shows, novels, etc.)
  title: string;
  year?: number;
  poster?: string;
}

// Simple validation functions - just check required fields exist
export function validateUserInfo(userInfo: any): userInfo is UserInfo {
  return (
    userInfo &&
    typeof userInfo.user_id === 'string' &&
    userInfo.user_id.length >= 1 &&
    typeof userInfo.username === 'string' &&
    userInfo.username.length >= 1 &&
    userInfo.username.length <= 50
  );
}

export function validateMediaInfo(mediaInfo: any): mediaInfo is MediaInfo {
  return (
    mediaInfo &&
    typeof mediaInfo.media_id === 'string' &&
    mediaInfo.media_id.length >= 1 &&
    typeof mediaInfo.type === 'string' &&
    mediaInfo.type.length >= 1 &&
    typeof mediaInfo.title === 'string' &&
    mediaInfo.title.length >= 1 &&
    mediaInfo.title.length <= 200
  );
}
