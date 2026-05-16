// Translation utility using Google Translate free endpoint (client=gtx)
// Same approach as AnymeX-Preview-Bot — no API key required
// Ported from Python aiohttp to Deno/TypeScript fetch
//
// MARKDOWN-AWARE: Extracts DiscordMarkdown syntax before translating,
// translates only the text content, then reassembles with markdown preserved.
//
// Supported DiscordMarkdown syntax (from AnymeX comment section):
//   **bold**, *italic*, ***bold+italic***, ~~strikethrough~~,
//   `inline code`, ||spoiler||, > blockquote, @mentions,
//   URLs, image URLs, line breaks

// ISO 639-1 language code → human-readable name
const LANG_NAMES: Record<string, string> = {
  af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', ar: 'Arabic', hy: 'Armenian',
  az: 'Azerbaijani', eu: 'Basque', be: 'Belarusian', bn: 'Bengali', bs: 'Bosnian',
  bg: 'Bulgarian', ca: 'Catalan', ceb: 'Cebuano', ny: 'Chichewa', zh: 'Chinese',
  'zh-cn': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)', co: 'Corsican',
  hr: 'Croatian', cs: 'Czech', da: 'Danish', nl: 'Dutch', en: 'English',
  eo: 'Esperanto', et: 'Estonian', tl: 'Filipino', fi: 'Finnish', fr: 'French',
  fy: 'Frisian', gl: 'Galician', ka: 'Georgian', de: 'German', el: 'Greek',
  gu: 'Gujarati', ht: 'Haitian Creole', ha: 'Hausa', haw: 'Hawaiian',
  he: 'Hebrew', iw: 'Hebrew', hi: 'Hindi', hmn: 'Hmong', hu: 'Hungarian',
  is: 'Icelandic', ig: 'Igbo', id: 'Indonesian', ga: 'Irish', it: 'Italian',
  ja: 'Japanese', jv: 'Javanese', kn: 'Kannada', kk: 'Kazakh', km: 'Khmer',
  ko: 'Korean', ku: 'Kurdish', ky: 'Kyrgyz', lo: 'Lao', la: 'Latin',
  lv: 'Latvian', lt: 'Lithuanian', lb: 'Luxembourgish', mk: 'Macedonian',
  mg: 'Malagasy', ms: 'Malay', ml: 'Malayalam', mt: 'Maltese', mi: 'Maori',
  mr: 'Marathi', mn: 'Mongolian', my: 'Myanmar', ne: 'Nepali', no: 'Norwegian',
  ps: 'Pashto', fa: 'Persian', pl: 'Polish', pt: 'Portuguese', pa: 'Punjabi',
  ro: 'Romanian', ru: 'Russian', sm: 'Samoan', gd: 'Scots Gaelic',
  sr: 'Serbian', st: 'Sesotho', sn: 'Shona', sd: 'Sindhi', si: 'Sinhala',
  sk: 'Slovak', sl: 'Slovenian', so: 'Somali', es: 'Spanish', su: 'Sundanese',
  sw: 'Swahili', sv: 'Swedish', tg: 'Tajik', ta: 'Tamil', te: 'Telugu',
  th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek',
  vi: 'Vietnamese', cy: 'Welsh', xh: 'Xhosa', yi: 'Yiddish', yo: 'Yoruba',
  zu: 'Zulu'
}

export interface TranslationResult {
  translatedContent: string | null
  originalLanguage: string | null
  languageName: string | null
  isAlreadyEnglish: boolean
}

// ─── Markdown Extraction & Reassembly ───────────────────────────────────────

interface MarkdownToken {
  type: 'placeholder'
  placeholder: string  // e.g. "{{MD0}}"
  original: string     // e.g. "**" or "||" or the full URL
}

/**
 * Extract markdown syntax from text, replacing with placeholders.
 * Returns the text with placeholders + a map to restore the original syntax.
 *
 * Order matters! Must match the same order as AnymeX's DiscordMarkdown parser:
 *   spoiler ||...|| → code `...` → bold+italic ***...*** → bold **...** →
 *   italic *...* → strikethrough ~~...~~ → @mentions → URLs → > blockquote
 */
function extractMarkdown(text: string): { text: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>()
  let tokenIndex = 0
  let result = text

  // Helper: replace regex matches with placeholders
  function replaceWithPlaceholder(regex: RegExp, prefix: string, suffix: string): void {
    result = result.replace(regex, (match: string, content: string) => {
      const placeholder = `{{MD${tokenIndex++}}}`
      // Store the full original markdown (prefix + content + suffix)
      tokens.set(placeholder, prefix + content + suffix)
      // Return: prefix placeholder + content + suffix placeholder
      const prefixPlaceholder = `{{MD${tokenIndex++}}}`
      const suffixPlaceholder = `{{MD${tokenIndex++}}}`
      tokens.set(prefixPlaceholder, prefix)
      tokens.set(suffixPlaceholder, suffix)
      return prefixPlaceholder + content + suffixPlaceholder
    })
  }

  // 1. Spoiler: ||text||
  replaceWithPlaceholder(/\|\|(.+?)\|\|/gs, '||', '||')

  // 2. Inline code: `text`
  replaceWithPlaceholder(/`([^`]+)`/g, '`', '`')

  // 3. Bold+Italic: ***text*** or ___text___
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, (match: string, content: string) => {
    const p1 = `{{MD${tokenIndex++}}}`
    const p2 = `{{MD${tokenIndex++}}}`
    tokens.set(p1, '***')
    tokens.set(p2, '***')
    return p1 + content + p2
  })
  result = result.replace(/___(.+?)___/g, (match: string, content: string) => {
    const p1 = `{{MD${tokenIndex++}}}`
    const p2 = `{{MD${tokenIndex++}}}`
    tokens.set(p1, '___')
    tokens.set(p2, '___')
    return p1 + content + p2
  })

  // 4. Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, (match: string, content: string) => {
    const p1 = `{{MD${tokenIndex++}}}`
    const p2 = `{{MD${tokenIndex++}}}`
    tokens.set(p1, '**')
    tokens.set(p2, '**')
    return p1 + content + p2
  })
  result = result.replace(/__(.+?)__/g, (match: string, content: string) => {
    const p1 = `{{MD${tokenIndex++}}}`
    const p2 = `{{MD${tokenIndex++}}}`
    tokens.set(p1, '__')
    tokens.set(p2, '__')
    return p1 + content + p2
  })

  // 5. Italic: *text* (single asterisk, not inside **)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (match: string, content: string) => {
    const p1 = `{{MD${tokenIndex++}}}`
    const p2 = `{{MD${tokenIndex++}}}`
    tokens.set(p1, '*')
    tokens.set(p2, '*')
    return p1 + content + p2
  })

  // 6. Strikethrough: ~~text~~
  replaceWithPlaceholder(/~~(.+?)~~/g, '~~', '~~')

  // 7. URLs: https://... (preserve entire URL, don't translate)
  result = result.replace(/https?:\/\/[^\s<>)\]]+/g, (url: string) => {
    const placeholder = `{{MD${tokenIndex++}}}`
    tokens.set(placeholder, url)
    return placeholder
  })

  // 8. @Mentions: @username (preserve the @, translate nothing)
  result = result.replace(/@(\w{1,32})/g, (match: string, username: string) => {
    const placeholder = `{{MD${tokenIndex++}}}`
    tokens.set(placeholder, '@' + username)
    return placeholder
  })

  // 9. Blockquote lines: > text (preserve the > prefix)
  result = result.replace(/^(>\s)/gm, (prefix: string) => {
    const placeholder = `{{MD${tokenIndex++}}}`
    tokens.set(placeholder, prefix)
    return placeholder
  })

  return { text: result, tokens }
}

/**
 * Restore markdown syntax from placeholders back into translated text.
 * Handles cases where Google Translate might slightly alter the placeholder.
 */
function restoreMarkdown(translatedText: string, tokens: Map<string, string>): string {
  let result = translatedText

  // Direct replacement — most common case
  for (const [placeholder, original] of tokens) {
    result = result.replace(placeholder, original)
  }

  // Cleanup: if any {{MD...}} placeholders remain (Google Translate mangled them),
  // try to extract the number and find a match
  result = result.replace(/\{\{MD(\d+)\}\}/g, (match: string, num: string) => {
    const key = `{{MD${num}}}`
    if (tokens.has(key)) {
      return tokens.get(key)!
    }
    // If no match found, remove the placeholder (safety fallback)
    return ''
  })

  return result
}

// ─── Core Translation ───────────────────────────────────────────────────────

/**
 * Translate text to the target language using Google Translate free endpoint (client=gtx).
 * Markdown-aware: extracts markdown syntax, translates only text content, then reassembles.
 * Auto-detects the source language.
 * If the text is already English or translation fails, returns gracefully.
 *
 * @param text - The text to translate (may contain markdown)
 * @param targetLang - Target language code (default: 'en')
 * @returns TranslationResult with translated content and detected language info
 */
export async function translateText(
  text: string,
  targetLang: string = 'en'
): Promise<TranslationResult> {
  // Empty/whitespace-only text — nothing to translate
  if (!text || !text.trim()) {
    return {
      translatedContent: null,
      originalLanguage: null,
      languageName: null,
      isAlreadyEnglish: false
    }
  }

  try {
    // Step 1: Extract markdown syntax → replace with placeholders
    const { text: plainText, tokens } = extractMarkdown(text)

    // Step 2: Translate the text with placeholders
    const encodedText = encodeURIComponent(plainText)
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodedText}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.error(`[Translate] API returned status ${response.status} for: ${text.substring(0, 80)}...`)
      return {
        translatedContent: null,
        originalLanguage: null,
        languageName: null,
        isAlreadyEnglish: false
      }
    }

    const data = await response.json()

    // Extract detected language code
    const detectedLang: string | null = (data.length > 2 && data[2]) ? String(data[2]) : null

    // Collect translated segments
    const translatedParts: string[] = []
    if (data && data[0] && Array.isArray(data[0])) {
      for (const segment of data[0]) {
        if (segment && segment[0]) {
          translatedParts.push(String(segment[0]))
        }
      }
    }
    let translated = translatedParts.join('').trim()

    // No translation produced
    if (!translated) {
      return {
        translatedContent: null,
        originalLanguage: detectedLang,
        languageName: detectedLang ? (LANG_NAMES[detectedLang] || detectedLang.toUpperCase()) : null,
        isAlreadyEnglish: false
      }
    }

    // Already English (case-insensitive comparison on the plain text)
    const isAlreadyEnglish = detectedLang === 'en' || translated.toLowerCase() === plainText.toLowerCase()
    if (isAlreadyEnglish) {
      return {
        translatedContent: null,
        originalLanguage: 'en',
        languageName: 'English',
        isAlreadyEnglish: true
      }
    }

    // Step 3: Restore markdown syntax from placeholders
    translated = restoreMarkdown(translated, tokens)

    const langName = detectedLang ? (LANG_NAMES[detectedLang] || detectedLang.toUpperCase()) : 'Unknown'
    console.log(`[Translate] ${detectedLang || '?'} → ${targetLang}: ${translated.substring(0, 80)}...`)

    return {
      translatedContent: translated,
      originalLanguage: detectedLang,
      languageName: langName,
      isAlreadyEnglish: false
    }

  } catch (error: any) {
    // Graceful fallback — never crash the comment system
    if (error?.name === 'AbortError') {
      console.error(`[Translate] Request timed out for: ${text.substring(0, 80)}...`)
    } else {
      console.error(`[Translate] Failed for "${text.substring(0, 80)}...": ${error?.message || error}`)
    }
    return {
      translatedContent: null,
      originalLanguage: null,
      languageName: null,
      isAlreadyEnglish: false
    }
  }
}

/**
 * Get the human-readable name for a language code
 */
export function getLanguageName(code: string): string {
  return LANG_NAMES[code] || code.toUpperCase()
}
