// Shared utilities for LangLab extension
export const languages = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'sv', name: 'Swedish', flag: '🇸🇪' },
  { code: 'no', name: 'Norwegian', flag: '🇳🇴' },
  { code: 'da', name: 'Danish', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', flag: '🇫🇮' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'cs', name: 'Czech', flag: '🇨🇿' },
  { code: 'hu', name: 'Hungarian', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', flag: '🇷🇴' },
  { code: 'bg', name: 'Bulgarian', flag: '🇧🇬' },
  { code: 'hr', name: 'Croatian', flag: '🇭🇷' },
  { code: 'sk', name: 'Slovak', flag: '🇸🇰' },
  { code: 'sl', name: 'Slovenian', flag: '🇸🇮' },
  { code: 'et', name: 'Estonian', flag: '🇪🇪' },
  { code: 'lv', name: 'Latvian', flag: '🇱🇻' },
  { code: 'lt', name: 'Lithuanian', flag: '🇱🇹' },
  { code: 'el', name: 'Greek', flag: '🇬🇷' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'he', name: 'Hebrew', flag: '🇮🇱' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', flag: '🇲🇾' },
  { code: 'tl', name: 'Filipino', flag: '🇵🇭' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'be', name: 'Belarusian', flag: '🇧🇾' },
  { code: 'ka', name: 'Georgian', flag: '🇬🇪' },
  { code: 'hy', name: 'Armenian', flag: '🇦🇲' },
  { code: 'az', name: 'Azerbaijani', flag: '🇦🇿' },
  { code: 'kk', name: 'Kazakh', flag: '🇰🇿' },
  { code: 'ky', name: 'Kyrgyz', flag: '🇰🇬' },
  { code: 'uz', name: 'Uzbek', flag: '🇺🇿' },
  { code: 'mn', name: 'Mongolian', flag: '🇲🇳' },
  { code: 'ne', name: 'Nepali', flag: '🇳🇵' },
  { code: 'si', name: 'Sinhala', flag: '🇱🇰' },
  { code: 'ta', name: 'Tamil', flag: '🇱🇰' },
  { code: 'te', name: 'Telugu', flag: '🇮🇳' },
  { code: 'ml', name: 'Malayalam', flag: '🇮🇳' },
  { code: 'kn', name: 'Kannada', flag: '🇮🇳' },
  { code: 'gu', name: 'Gujarati', flag: '🇮🇳' },
  { code: 'pa', name: 'Punjabi', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', flag: '🇧🇩' },
  { code: 'ur', name: 'Urdu', flag: '🇵🇰' },
  { code: 'fa', name: 'Persian', flag: '🇮🇷' },
  { code: 'ps', name: 'Pashto', flag: '🇦🇫' },
  { code: 'sw', name: 'Swahili', flag: '🇰🇪' },
  { code: 'am', name: 'Amharic', flag: '🇪🇹' },
  { code: 'yo', name: 'Yoruba', flag: '🇳🇬' },
  { code: 'ig', name: 'Igbo', flag: '🇳🇬' },
  { code: 'ha', name: 'Hausa', flag: '🇳🇬' },
  { code: 'zu', name: 'Zulu', flag: '🇿🇦' },
  { code: 'af', name: 'Afrikaans', flag: '🇿🇦' },
  { code: 'is', name: 'Icelandic', flag: '🇮🇸' },
  { code: 'ga', name: 'Irish', flag: '🇮🇪' },
  { code: 'cy', name: 'Welsh', flag: '🇬🇧' },
  { code: 'mt', name: 'Maltese', flag: '🇲🇹' },
  { code: 'eu', name: 'Basque', flag: '🇪🇸' },
  { code: 'ca', name: 'Catalan', flag: '🇪🇸' },
  { code: 'gl', name: 'Galician', flag: '🇪🇸' }
];

const isTranslatorSupported = 'Translator' in self;
const supportedLanguagePairs = new Map();

export async function checkLanguagePairAvailability(sourceLang, targetLang) {
  if (!isTranslatorSupported) {
    return 'unknown'; 
  }

  const pairKey = `${sourceLang}-${targetLang}`;
  
  if (supportedLanguagePairs.has(pairKey)) {
    return supportedLanguagePairs.get(pairKey);
  }

  try {
    const availability = await Translator.availability({
      sourceLanguage: sourceLang,
      targetLanguage: targetLang
    });
    
    supportedLanguagePairs.set(pairKey, availability);
    return availability;
  } catch (error) {
    console.warn(`Failed to check availability for ${sourceLang}-${targetLang}:`, error);
    return 'unknown';
  }
}

export function populateLanguageSelect(selectElement, placeholder = 'Select language') {
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  selectElement.appendChild(placeholderOption);

  languages.forEach(lang => {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = `${lang.flag} ${lang.name}`;
    selectElement.appendChild(option);
  });
}

export function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

export async function saveWordsToSidebar(words, url, title, translation, sourceLanguage) {
  try {
    // Get existing words from sidebar storage
    const result = await chrome.storage.local.get(['langlabSavedWords']);
    const existingWords = result.langlabSavedWords || [];
    
    // Filter out words that already exist for this URL
    const newWords = words.filter(word => 
      !existingWords.some(existing => 
        existing.word.toLowerCase() === word.toLowerCase() && 
        existing.url === url
      )
    );

    if (newWords.length === 0) {
      console.log('All selected words already exist for this URL');
      return { success: false, reason: 'already_exists' };
    }

    // Create new word objects
    const timestamp = Date.now();
    const wordsToAdd = newWords.map(word => ({
      id: `${url}-${word}-${timestamp}-${Math.random()}`,
      word: word,
      translation: translation || '',
      url: url,
      title: title || url,
      timestamp: timestamp,
      domain: getDomainFromUrl(url),
      sourceLanguage: sourceLanguage || 'unknown',
      correctAnswers: 0,
      isKnown: false
    }));

    // Add to existing words and save
    const updatedWords = [...existingWords, ...wordsToAdd];
    await chrome.storage.local.set({ langlabSavedWords: updatedWords });
    
    console.log('Saved words to sidebar storage:', wordsToAdd.length);
    return { success: true, newWordsCount: wordsToAdd.length };
  } catch (error) {
    console.error('Failed to save words to sidebar storage:', error);
    return { success: false, error: error.message };
  }
}
