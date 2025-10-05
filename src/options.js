(() => {
  // Comprehensive list of languages with their codes and flags
  const languages = [
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

  const userLangEl = document.getElementById('userLang');
  const learnLangEl = document.getElementById('learnLang');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusEl = document.getElementById('status');

  // Check if Translator API is supported
  const isTranslatorSupported = 'Translator' in self;
  let supportedLanguagePairs = new Map();

  function showStatus(msg) {
    statusEl.textContent = msg || '';
    if (!msg) return;
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  }

  // Check if a language pair is supported by the Translator API
  async function checkLanguagePairAvailability(sourceLang, targetLang) {
    if (!isTranslatorSupported) {
      return 'unknown'; // Assume supported if API not available
    }

    const pairKey = `${sourceLang}-${targetLang}`;
    
    // Return cached result if available
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

  // Update learning language options based on native language selection
  async function updateLearningLanguageOptions() {
    const selectedNativeLang = userLangEl.value;
    const currentLearningLang = learnLangEl.value;
    
    if (!selectedNativeLang) {
      // Reset to all languages
      learnLangEl.innerHTML = '<option value="">Select language to learn</option>';
      languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = `${lang.flag} ${lang.name}`;
        learnLangEl.appendChild(option);
      });
      return;
    }

    // Show loading state
    learnLangEl.innerHTML = '<option value="">Checking available languages...</option>';
    learnLangEl.disabled = true;

    try {
      // Check availability for each language pair
      const availabilityPromises = languages.map(async (lang) => {
        if (lang.code === selectedNativeLang) return null; // Skip same language
        
        const availability = await checkLanguagePairAvailability(selectedNativeLang, lang.code);
        return { lang, availability };
      });

      const results = await Promise.all(availabilityPromises);
      
      // Filter and populate options
      learnLangEl.innerHTML = '<option value="">Select language to learn</option>';
      
      const availableLanguages = results
        .filter(result => result && (result.availability === 'available' || result.availability === 'downloadable'))
        .map(result => result.lang);

      const unavailableLanguages = results
        .filter(result => result && result.availability === 'unavailable')
        .map(result => result.lang);

      // Add available languages first
      availableLanguages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = `${lang.flag} ${lang.name}`;
        learnLangEl.appendChild(option);
      });

      // Add unavailable languages with indication
      if (unavailableLanguages.length > 0) {
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '─── Limited support ───';
        learnLangEl.appendChild(separator);

        unavailableLanguages.forEach(lang => {
          const option = document.createElement('option');
          option.value = lang.code;
          option.textContent = `${lang.flag} ${lang.name} (limited)`;
          option.style.color = '#9ca3af';
          learnLangEl.appendChild(option);
        });
      }

      // Restore previous selection if still available
      if (currentLearningLang && learnLangEl.querySelector(`option[value="${currentLearningLang}"]`)) {
        learnLangEl.value = currentLearningLang;
      }

    } catch (error) {
      console.error('Failed to check language availability:', error);
      // Fallback to showing all languages
      learnLangEl.innerHTML = '<option value="">Select language to learn</option>';
      languages.forEach(lang => {
        if (lang.code !== selectedNativeLang) {
          const option = document.createElement('option');
          option.value = lang.code;
          option.textContent = `${lang.flag} ${lang.name}`;
          learnLangEl.appendChild(option);
        }
      });
    } finally {
      learnLangEl.disabled = false;
    }
  }

  // Populate language dropdowns
  function populateLanguageSelect(selectElement, placeholder = 'Select language') {
    // Add placeholder option
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder;
    selectElement.appendChild(placeholderOption);

    // Add language options
    languages.forEach(lang => {
      const option = document.createElement('option');
      option.value = lang.code;
      option.textContent = `${lang.flag} ${lang.name}`;
      selectElement.appendChild(option);
    });
  }

  function load() {
    try {
      if (!chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(['weblangUserLang', 'weblangLearnLang'], (res) => {
        userLangEl.value = (res && res.weblangUserLang) || '';
        learnLangEl.value = (res && res.weblangLearnLang) || '';
      });
    } catch {}
  }

  function save() {
    const userLang = userLangEl.value || '';
    const learnLang = learnLangEl.value || '';
    try {
      if (!chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ 
        weblangUserLang: userLang, 
        weblangLearnLang: learnLang,
        weblangSetupCompleted: true,
        weblangSetupDate: Date.now()
      }, () => {
        // Notify other parts of the extension that language settings have been updated
        try {
          chrome.runtime.sendMessage({ type: 'LANGUAGE_SETTINGS_UPDATED' });
        } catch (error) {
          console.warn('Failed to notify language settings update:', error);
        }
        showStatus('Saved');
      });
    } catch {}
  }

  function reset() {
    userLangEl.value = '';
    learnLangEl.value = '';
    try {
      if (!chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.remove(['weblangUserLang', 'weblangLearnLang', 'weblangSetupCompleted', 'weblangSetupDate'], () => {
        showStatus('Reset');
      });
    } catch {}
  }

  // Initialize the options page
  function init() {
    // Populate language dropdowns
    populateLanguageSelect(userLangEl, 'Select your native language');
    populateLanguageSelect(learnLangEl, 'Select language to learn');
    
    // Add event listener for native language changes
    userLangEl.addEventListener('change', async () => {
      await updateLearningLanguageOptions();
    });
    
    // Load existing settings
    load();
  }

  saveBtn.addEventListener('click', save);
  resetBtn.addEventListener('click', reset);
  init();
})();


