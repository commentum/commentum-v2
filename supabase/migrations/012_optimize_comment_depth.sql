-- Migration: Optimize comment depth calculation
-- Creates a recursive CTE function to get comment depth in a single query
-- This replaces the slow loop-based approach

-- Function to get the depth/nesting level of a comment
CREATE OR REPLACE FUNCTION get_comment_depth(comment_id BIGINT)
RETURNS INTEGER AS $$
DECLARE
    depth INTEGER;
BEGIN
    WITH RECURSIVE comment_ancestors AS (
        -- Base case: start with the target comment
        SELECT id, parent_id, 0 AS depth
        FROM comments
        WHERE id = comment_id
        
        UNION ALL
        
        -- Recursive case: join to parent
        SELECT c.id, c.parent_id, ca.depth + 1
        FROM comments c
        INNER JOIN comment_ancestors ca ON c.id = ca.parent_id
        WHERE ca.parent_id IS NOT NULL
    )
    SELECT COALESCE(MAX(depth), 0) INTO depth
    FROM comment_ancestors;
    
    RETURN depth;
END;
$$ LANGUAGE plpgsql;

-- Add index for faster parent lookups
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);

-- Add composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_comments_media_client ON comments(media_id, client_type);
