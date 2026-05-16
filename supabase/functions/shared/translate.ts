// Translation utility using Google Translate free endpoint (client=gtx)
// Same approach as AnymeX-Preview-Bot — no API key required
// Ported from Python aiohttp to Deno/TypeScript fetch
//
// MARKDOWN-AWARE: Extracts DiscordMarkdown syntax before translating,
// translates only the text content, then reassembles with markdown preserved.
//
// Strategy: Replace each markdown block with a SINGLE placeholder that
// contains only the inner text. Google Translate translates the placeholder
// + surrounding text as a unit. After translation, we find the translated
// placeholder content and re-wrap it with the original markdown markers.
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

/**
 * A markdown block that was extracted from the text.
 * For example, **hello** becomes:
 *   placeholder = "{{MD0}}"  (replaces the whole block in the text sent to Google)
 *   prefix = "**"
 *   suffix = "**"
 *   innerText = "hello"
 *
 * During restoration, we find "{{MD0}}" in the translated text and replace it
 * with prefix + translatedInnerText + suffix.
 */
interface MarkdownBlock {
  placeholder: string
  prefix: string
  suffix: string
  innerText: string
}

/**
 * A non-translatable token (URLs, @mentions, blockquote prefixes).
 * These are replaced with a placeholder and restored verbatim after translation.
 */
interface VerbatimToken {
  placeholder: string
  original: string
}

/**
 * Extract markdown syntax from text, replacing markdown blocks with placeholders.
 *
 * Key design: Each markdown block (**text**, *text*, etc.) becomes a SINGLE
 * placeholder — not separate prefix/suffix placeholders. This prevents Google
 * Translate from separating the markers from the content.
 *
 * The placeholder contains only the inner text, which Google Translate will
 * translate in-place. We then re-wrap the translated inner text with the
 * original prefix/suffix markers.
 *
 * Order matters! Same as AnymeX's DiscordMarkdown parser:
 *   spoiler ||...|| → code `...` → bold+italic ***...*** → bold **...** →
 *   italic *...* → strikethrough ~~...~~ → @mentions → URLs → > blockquote
 */
function extractMarkdown(text: string): {
  text: string
  blocks: MarkdownBlock[]
  verbatim: VerbatimToken[]
} {
  const blocks: MarkdownBlock[] = []
  const verbatim: VerbatimToken[] = []
  let tokenIndex = 0
  let result = text

  // Helper: replace markdown block (prefix + content + suffix) with single placeholder
  function replaceBlock(regex: RegExp, prefix: string, suffix: string): void {
    result = result.replace(regex, (_match: string, content: string) => {
      const placeholder = `{{MD${tokenIndex++}}}`
      blocks.push({ placeholder, prefix, suffix, innerText: content })
      return placeholder
    })
  }

  // Helper: replace non-translatable token with single placeholder (restored verbatim)
  function replaceVerbatim(regex: RegExp, toPlaceholder: (match: string) => string): void {
    result = result.replace(regex, (match: string) => {
      const placeholder = `{{MD${tokenIndex++}}}`
      verbatim.push({ placeholder, original: toPlaceholder(match) })
      return placeholder
    })
  }

  // 1. Spoiler: ||text|| → single placeholder
  replaceBlock(/\|\|(.+?)\|\|/gs, '||', '||')

  // 2. Inline code: `text` → single placeholder (don't translate code content)
  replaceBlock(/`([^`]+)`/g, '`', '`')

  // 3. Bold+Italic: ***text*** or ___text___
  replaceBlock(/\*\*\*(.+?)\*\*\*/g, '***', '***')
  replaceBlock(/___(.+?)___/g, '___', '___')

  // 4. Bold: **text** or __text__
  replaceBlock(/\*\*(.+?)\*\*/g, '**', '**')
  replaceBlock(/__(.+?)__/g, '__', '__')

  // 5. Italic: *text* (single asterisk, not inside **)
  replaceBlock(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '*', '*')

  // 6. Strikethrough: ~~text~~
  replaceBlock(/~~(.+?)~~/g, '~~', '~~')

  // 7. URLs: https://... (preserve entire URL verbatim — don't translate)
  replaceVerbatim(/https?:\/\/[^\s<>)\]]+/g, (url) => url)

  // 8. @Mentions: @username (preserve verbatim)
  replaceVerbatim(/@(\w{1,32})/g, (match) => match)

  // 9. Blockquote lines: > text (preserve the > prefix verbatim)
  replaceVerbatim(/^(>\s)/gm, (prefix) => prefix)

  return { text: result, blocks, verbatim }
}

/**
 * Restore markdown syntax from placeholders back into translated text.
 *
 * For MarkdownBlocks: find the placeholder in the translated text, replace it
 * with prefix + (translated inner text, which Google already translated) + suffix.
 *
 * For VerbatimTokens: find the placeholder and restore the original text exactly.
 *
 * Fallback: If Google Translate mangled a placeholder (e.g., removed {{ }}),
 * we try to match by inner text content.
 */
function restoreMarkdown(
  translatedText: string,
  blocks: MarkdownBlock[],
  verbatim: VerbatimToken[]
): string {
  let result = translatedText

  // Restore verbatim tokens first (URLs, @mentions, blockquote prefixes)
  // These must match exactly since they weren't translated
  for (const { placeholder, original } of verbatim) {
    result = result.replace(placeholder, original)
  }

  // Restore markdown blocks — the placeholder was translated in-place
  // by Google Translate, so we need to find it and wrap with prefix/suffix
  for (const { placeholder, prefix, suffix } of blocks) {
    // Try exact placeholder match first
    if (result.includes(placeholder)) {
      result = result.replace(placeholder, (matched) => {
        // The placeholder itself was sent to Google Translate.
        // If Google left it untouched, just wrap: prefix + original innerText + suffix
        // But if Google translated the innerText inside the placeholder... that shouldn't
        // happen because we replaced the WHOLE block with just the placeholder.
        // So the placeholder should be untouched in the translated text.
        return prefix + suffix
      })
      // Wait — that's wrong. The placeholder replaces the whole block including innerText.
      // Google sees only "{{MD5}}" and should pass it through unchanged.
      // Then we need to re-wrap the ORIGINAL innerText with markers.
      // But we want the TRANSLATED innerText, not the original...
      //
      // Actually, the problem is: if we replace **hello** with just {{MD5}},
      // Google doesn't see "hello" at all — it only sees the placeholder.
      // So "hello" never gets translated!
      //
      // We need a different approach: keep the innerText in the placeholder
      // so Google Translate can translate it, then re-wrap with markers.
    }
  }

  // ── REVISED APPROACH ──────────────────────────────────────────────────────
  // The above won't work because we stripped the innerText.
  // Let's redo: extractMarkdown should keep innerText inside the placeholder
  // so Google Translate sees and translates it.
  // We handle this in the REVISED extractMarkdown below.

  return result
}

// ─── REVISED: Better extraction ─────────────────────────────────────────────
// Instead of replacing the whole block with a bare placeholder,
// we replace it with: prefix_placeholder + innerText + suffix_placeholder
// BUT we use NAMED markers that Google Translate won't break:
//   {{B#}} for block start, {{E#}} for block end
// The innerText between them gets translated by Google.

interface MdToken {
  id: number
  marker: string   // The original markdown marker (e.g. "**", "||", "*", "`")
  type: 'wrap' | 'verbatim'
  original?: string // For verbatim tokens (URLs, @mentions)
}

function extractMarkdownV2(text: string): { text: string; tokens: Map<number, MdToken> } {
  const tokens = new Map<number, MdToken>()
  let id = 0
  let result = text

  // Helper: wrap markdown block with {{B#}}innerText{{E#}} markers
  function wrapBlock(regex: RegExp, marker: string): void {
    result = result.replace(regex, (_match: string, content: string) => {
      const tokenId = id++
      tokens.set(tokenId, { id: tokenId, marker, type: 'wrap' })
      return `{{B${tokenId}}}${content}{{E${tokenId}}}`
    })
  }

  // Helper: replace verbatim token (URL, @mention) with single placeholder
  function replaceVerbatim(regex: RegExp, marker: string, toOriginal?: (match: string) => string): void {
    result = result.replace(regex, (match: string, ...args: any[]) => {
      const tokenId = id++
      const original = toOriginal ? toOriginal(match, ...args) : match
      tokens.set(tokenId, { id: tokenId, marker, type: 'verbatim', original })
      return `{{V${tokenId}}}`
    })
  }

  // 1. Spoiler: ||text||
  wrapBlock(/\|\|(.+?)\|\|/gs, '||')

  // 2. Inline code: `text` — keep the backticks as markers
  wrapBlock(/`([^`]+)`/g, '`')

  // 3. Bold+Italic: ***text*** or ___text___
  wrapBlock(/\*\*\*(.+?)\*\*\*/g, '***')
  wrapBlock(/___(.+?)___/g, '___')

  // 4. Bold: **text** or __text__
  wrapBlock(/\*\*(.+?)\*\*/g, '**')
  wrapBlock(/__(.+?)__/g, '__')

  // 5. Italic: *text* (single asterisk, not inside **)
  wrapBlock(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '*')

  // 6. Strikethrough: ~~text~~
  wrapBlock(/~~(.+?)~~/g, '~~')

  // 7. URLs: preserve verbatim
  replaceVerbatim(/https?:\/\/[^\s<>)\]]+/g, 'url')

  // 8. @Mentions: preserve verbatim
  replaceVerbatim(/@(\w{1,32})/g, 'mention', (match: string) => match)

  // 9. Blockquote lines: preserve > prefix verbatim
  replaceVerbatim(/^(>\s)/gm, 'blockquote', (prefix: string) => prefix)

  return { text: result, tokens }
}

/**
 * Restore markdown from V2 format.
 * Google Translate sees: {{B0}}some text{{E0}}
 * It translates the "some text" part and usually preserves the {{B0}}/{{E0}} markers.
 * We then convert {{B0}}...{{E0}} back to **...** (or whatever the marker was).
 *
 * If Google mangles the markers (rare but possible), we fall back to regex cleanup.
 */
function restoreMarkdownV2(translatedText: string, tokens: Map<number, MdToken>): string {
  let result = translatedText

  // Restore wrap tokens: {{B#}}translated text{{E#}} → marker + translated text + marker
  for (const [id, token] of tokens) {
    if (token.type === 'wrap') {
      // Try exact match: {{B3}}some text{{E3}} → **some text**
      const regex = new RegExp(`\\{\\{B${id}\\}\\}([\\s\\S]*?)\\{\\{E${id}\\}\\}`, 'g')
      result = result.replace(regex, (_match: string, content: string) => {
        return token.marker + content + token.marker
      })
    } else if (token.type === 'verbatim') {
      // Verbatim tokens: {{V5}} → original URL/mention/etc
      result = result.replace(`{{V${id}}}`, token.original || '')
    }
  }

  // Fallback cleanup: if any {{B#}} or {{E#}} or {{V#}} markers remain
  // (Google Translate mangled them), try to clean up
  result = result.replace(/\{\{B(\d+)\}\}/g, (match: string, num: string) => {
    const tokenId = parseInt(num)
    const token = tokens.get(tokenId)
    if (token && token.type === 'wrap') {
      return token.marker // Just output the marker, hope the content follows
    }
    return ''
  })
  result = result.replace(/\{\{E(\d+)\}\}/g, (match: string, num: string) => {
    const tokenId = parseInt(num)
    const token = tokens.get(tokenId)
    if (token && token.type === 'wrap') {
      return token.marker
    }
    return ''
  })
  result = result.replace(/\{\{V(\d+)\}\}/g, (match: string, num: string) => {
    const tokenId = parseInt(num)
    const token = tokens.get(tokenId)
    if (token && token.type === 'verbatim') {
      return token.original || ''
    }
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
    // Step 1: Extract markdown syntax → wrap with B/E markers
    const { text: markedText, tokens } = extractMarkdownV2(text)

    // Step 2: Translate the text with markdown markers
    const encodedText = encodeURIComponent(markedText)
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
    const isAlreadyEnglish = detectedLang === 'en' || translated.toLowerCase() === markedText.toLowerCase()
    if (isAlreadyEnglish) {
      return {
        translatedContent: null,
        originalLanguage: 'en',
        languageName: 'English',
        isAlreadyEnglish: true
      }
    }

    // Step 3: Restore markdown syntax from B/E markers
    translated = restoreMarkdownV2(translated, tokens)

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
