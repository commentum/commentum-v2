// User management utilities for Commentum v2
// Centralizes user operations with the new users table

export interface UserProfile {
    id: number;
    user_id: string;
    client_type: string;
    username: string;
    user_avatar?: string;
    user_role: 'user' | 'moderator' | 'admin' | 'super_admin' | 'owner';
    user_banned: boolean;
    user_shadow_banned: boolean;
    user_muted_until?: string;
    user_warnings: number;
    total_comments: number;
    total_upvotes_received: number;
    total_downvotes_received: number;
    total_votes_cast: number;
    total_reports_filed: number;
    total_reports_received: number;
    total_pinned_comments: number;
    total_deleted_comments: number;
    last_comment_at?: string;
    last_vote_at?: string;
    last_report_at?: string;
    created_at: string;
    updated_at: string;
}

export interface UserInfo {
    user_id: string;
    username: string;
    avatar?: string;
}

// Get or create user record
export async function getOrCreateUser(supabase: any, userId: string, clientType: string, username: string, avatar?: string): Promise<UserProfile | null> {
    try {
        const { data, error } = await supabase
            .rpc('get_or_create_user', {
                p_user_id: userId,
                p_client_type: clientType,
                p_username: username,
                p_user_avatar: avatar || null
            });

        if (error) {
            console.error('Error getting/creating user:', error);
            return null;
        }

        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Get or create user error:', error);
        return null;
    }
}

// Get user details (with optional admin view)
export async function getUserDetails(supabase: any, userId: string, clientType: string, includeHidden: boolean = false): Promise<UserProfile | null> {
    try {
        const { data, error } = await supabase
            .rpc('get_user_details', {
                p_user_id: userId,
                p_client_type: clientType,
                p_include_hidden: includeHidden
            });

        if (error) {
            console.error('Error getting user details:', error);
            return null;
        }

        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        console.error('Get user details error:', error);
        return null;
    }
}

// Update user statistics
export async function updateUserStats(
    supabase: any, 
    userId: string, 
    clientType: string, 
    statType: 'comment' | 'vote' | 'report_filed' | 'report_received' | 'pin' | 'delete',
    increment: number = 1,
    decrement: number = 0
): Promise<boolean> {
    try {
        const { error } = await supabase
            .rpc('update_user_stats', {
                p_user_id: userId,
                p_client_type: clientType,
                p_stat_type: statType,
                p_increment: increment,
                p_decrement: decrement
            });

        if (error) {
            console.error('Error updating user stats:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Update user stats error:', error);
        return false;
    }
}

// Apply moderation action to user
export async function applyUserModeration(
    supabase: any,
    userId: string,
    clientType: string,
    action: 'warn' | 'mute' | 'ban' | 'shadow_ban' | 'unban' | 'unmute',
    durationHours?: number,
    reason?: string,
    moderatorId?: string
): Promise<boolean> {
    try {
        const { error } = await supabase
            .rpc('apply_user_moderation', {
                p_user_id: userId,
                p_client_type: clientType,
                p_action: action,
                p_duration_hours: durationHours || null,
                p_reason: reason || null,
                p_moderator_id: moderatorId || null
            });

        if (error) {
            console.error('Error applying user moderation:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Apply user moderation error:', error);
        return false;
    }
}

// Check if user is currently muted
export function isUserMuted(user: UserProfile): boolean {
    if (!user.user_muted_until) return false;
    return new Date(user.user_muted_until) > new Date();
}

// Check if user can perform actions (not banned, not muted, not shadow-banned)
export function canUserAct(user: UserProfile): boolean {
    return !user.user_banned && !user.user_shadow_banned && !isUserMuted(user);
}

// Get user's current status for display
export function getUserStatus(user: UserProfile): string[] {
    const status: string[] = [];
    
    if (user.user_banned) status.push('Banned');
    if (user.user_shadow_banned) status.push('Shadow Banned');
    if (isUserMuted(user)) status.push(`Muted until ${new Date(user.user_muted_until!).toLocaleDateString()}`);
    if (user.user_warnings > 0) status.push(`${user.user_warnings} warnings`);
    
    return status;
}

// Update user profile information (username, avatar)
export async function updateUserProfile(
    supabase: any,
    userId: string,
    clientType: string,
    username: string,
    avatar?: string
): Promise<boolean> {
    try {
        const { error } = await supabase
            .from('users')
            .update({
                username,
                user_avatar: avatar || null,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('client_type', clientType);

        if (error) {
            console.error('Error updating user profile:', error);
            return false;
        }

        return true;
    } catch (error) {
        console.error('Update user profile error:', error);
        return false;
    }
}

// Get user statistics for display
export function getUserStats(user: UserProfile): any {
    return {
        comments: user.total_comments,
        upvotesReceived: user.total_upvotes_received,
        downvotesReceived: user.total_downvotes_received,
        votesCast: user.total_votes_cast,
        reportsFiled: user.total_reports_filed,
        reportsReceived: user.total_reports_received,
        pinnedComments: user.total_pinned_comments,
        deletedComments: user.total_deleted_comments,
        warnings: user.user_warnings,
        joinDate: user.created_at,
        lastActivity: getLastActivity(user)
    };
}

// Helper to get last activity timestamp
function getLastActivity(user: UserProfile): string {
    const activities = [
        user.last_comment_at,
        user.last_vote_at,
        user.last_report_at
    ].filter(Boolean);

    if (activities.length === 0) return user.created_at;
    
    return activities.reduce((latest, current) => 
        new Date(current) > new Date(latest) ? current : latest
    );
}

// Batch get multiple users (for admin panels)
export async function getMultipleUsers(
    supabase: any,
    filters: {
        client_type?: string;
        role?: string;
        banned?: boolean;
        shadow_banned?: boolean;
        min_warnings?: number;
        limit?: number;
        offset?: number;
    }
): Promise<{ users: UserProfile[], total: number }> {
    try {
        let query = supabase
            .from('users')
            .select('*', { count: 'exact' });

        // Apply filters
        if (filters.client_type) {
            query = query.eq('client_type', filters.client_type);
        }
        if (filters.role) {
            query = query.eq('user_role', filters.role);
        }
        if (filters.banned !== undefined) {
            query = query.eq('user_banned', filters.banned);
        }
        if (filters.shadow_banned !== undefined) {
            query = query.eq('user_shadow_banned', filters.shadow_banned);
        }
        if (filters.min_warnings) {
            query = query.gte('user_warnings', filters.min_warnings);
        }

        // Apply pagination
        if (filters.limit) {
            query = query.limit(filters.limit);
        }
        if (filters.offset) {
            query = query.offset(filters.offset);
        }

        // Order by most recent activity
        query = query.order('updated_at', { ascending: false });

        const { data, error, count } = await query;

        if (error) {
            console.error('Error getting multiple users:', error);
            return { users: [], total: 0 };
        }

        return {
            users: data || [],
            total: count || 0
        };
    } catch (error) {
        console.error('Get multiple users error:', error);
        return { users: [], total: 0 };
    }
}

// Search users by username
export async function searchUsers(
    supabase: any,
    searchTerm: string,
    clientType?: string,
    limit: number = 20
): Promise<UserProfile[]> {
    try {
        let query = supabase
            .from('users')
            .select('*')
            .ilike('username', `%${searchTerm}%`)
            .limit(limit)
            .order('username', { ascending: true });

        if (clientType) {
            query = query.eq('client_type', clientType);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error searching users:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Search users error:', error);
        return [];
    }
}