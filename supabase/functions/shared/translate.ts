// Translation utility using Google Translate free endpoint (client=gtx)
// Same approach as AnymeX-Preview-Bot — no API key required
// Ported from Python aiohttp to Deno/TypeScript fetch

// ISO 639-1 language code → human-readable name
const LANG_NAMES: Record<string, string> = {
  af: 'Afrikaans', sq: 'Albanian', am: 'Amharic', ar: 'Arabic', hy: 'Armenian',
  az: 'Azerbaijani', eu: 'Basque', be: 'Belarusian', bn: 'Bengali', bs: 'Bosnian',
  bg: 'Bulgarian', ca: 'Catalan', ceb: 'Cebuano', ny: 'Chichewa', zh: 'Chinese',
  zh-cn: 'Chinese (Simplified)', zh-tw: 'Chinese (Traditional)', co: 'Corsican',
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

/**
 * Translate text to English using Google Translate free endpoint (client=gtx).
 * Auto-detects the source language.
 * If the text is already English or translation fails, returns gracefully.
 *
 * @param text - The text to translate
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
    const encodedText = encodeURIComponent(text)
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
    const translated = translatedParts.join('').trim()

    // No translation produced
    if (!translated) {
      return {
        translatedContent: null,
        originalLanguage: detectedLang,
        languageName: detectedLang ? (LANG_NAMES[detectedLang] || detectedLang.toUpperCase()) : null,
        isAlreadyEnglish: false
      }
    }

    // Already English (case-insensitive comparison)
    const isAlreadyEnglish = detectedLang === 'en' || translated.toLowerCase() === text.toLowerCase()
    if (isAlreadyEnglish) {
      return {
        translatedContent: null,
        originalLanguage: 'en',
        languageName: 'English',
        isAlreadyEnglish: true
      }
    }

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
