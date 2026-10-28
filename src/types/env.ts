export interface Bindings {
  DB: D1Database;
  JWT_SECRET: string;
  ENVIRONMENT?: string;

  // Firebase Cloud Messaging (FCM)
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;

  // Discord Bot Integration
  DISCORD_BOT_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_COMMAND_SYNC_ON_BOOT?: string;

  // Dantotsu Sync Integration
  DANTOTSU_API_URL?: string;
  DANTOTSU_APP_AUTH?: string;
}

export interface UserJwtPayload {
  sub: string;             // unified identifier e.g. "anilist:12345"
  uid: string;             // platform user id e.g. "12345"
  provider: string;        // "anilist" | "mal" | "simkl" | "other"
  username: string;
  role: string;            // "user" | "moderator" | "admin" | "super_admin" | "owner" | "app_owner"
  avatar?: string;
  exp: number;
  iat: number;
}

export type AppContext = {
  Bindings: Bindings;
  Variables: {
    user?: UserJwtPayload;
  };
};
