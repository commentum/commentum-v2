// Mention parsing and markdown utilities
// Used for @mention notification system and push notification text formatting

/**
 * Parse @username mentions from comment content
 * Returns unique lowercase usernames (case-insensitive match)
 * Handles: @username, @user_name, @user123
 * Skips: email addresses (user@domain.com), markdown links
 */
export function parseMentions(content: string): string[] {
  const mentions = new Set<string>()

  // Match @username patterns
  // Negative lookbehind for word characters to skip emails
  // Username: 1-50 chars, alphanumeric + underscores
  const mentionRegex = /(^|[\s>(!\[{,])@(\w{1,50})/g
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(content)) !== null) {
    const username = match[2].toLowerCase()
    // Skip if it looks like an email (next char after username is @ or .)
    const nextCharIdx = match.index + match[0].length
    const nextChar = content[nextCharIdx]
    if (nextChar === '@' || nextChar === '.') continue

    mentions.add(username)
  }

  return Array.from(mentions)
}

/**
 * Strip markdown formatting from text for plain text use
 * Used for push notification body previews
 * Removes: headers, bold, italic, strikethrough, code, links, images, blockquotes, lists
 */
export function stripMarkdown(text: string): string {
  if (!text) return ''

  let result = text

  // Remove images: ![alt](url)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

  // Remove links: [text](url) -> text
  result = result.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')

  // Remove inline code: `code`
  result = result.replace(/`([^`]+)`/g, '$1')

  // Remove code blocks: ```...```
  result = result.replace(/```[\s\S]*?```/g, '')

  // Remove bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1')
  result = result.replace(/__([^_]+)__/g, '$1')

  // Remove italic: *text* or _text_
  result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
  result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1')

  // Remove strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '$1')

  // Remove headings: # text
  result = result.replace(/^#{1,6}\s+/gm, '')

  // Remove blockquotes: > text
  result = result.replace(/^>\s?/gm, '')

  // Remove unordered list markers: - or * at start of line
  result = result.replace(/^[\s]*[-*+]\s+/gm, '')

  // Remove ordered list markers: 1. at start of line
  result = result.replace(/^[\s]*\d+\.\s+/gm, '')

  // Remove horizontal rules: ---, ***, ___
  result = result.replace(/^[-*_]{3,}\s*$/gm, '')

  // Remove spoiler tags: >!text!< (common in anime communities)
  result = result.replace(/>!([^<]*)!</g, '$1')

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.trim()

  return result
}

/**
 * Truncate text for push notification preview
 * Strips markdown first, then truncates with ellipsis
 */
export function getPlainTextPreview(text: string, maxLength: number = 80): string {
  const plain = stripMarkdown(text)
  if (plain.length <= maxLength) return plain
  return plain.substring(0, maxLength) + '...'
}
