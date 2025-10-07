(() => {
  const { languages, populateLanguageSelect, checkLanguagePairAvailability } = window.langlab;

  const userLangEl = document.getElementById('userLang');
  const learnLangEl = document.getElementById('learnLang');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusEl = document.getElementById('status');

  function createElement(tag, className, styles = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    Object.assign(el.style, styles);
    return el;
  }

  function showStatus(msg) {
    statusEl.textContent = msg || '';
    if (!msg) return;
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  }

  // Update learning language options based on native language selection
  async function updateLearningLanguageOptions() {
    const selectedNativeLang = userLangEl.value;
    const currentLearningLang = learnLangEl.value;
    
    if (!selectedNativeLang) {
      // Reset to all languages
      learnLangEl.innerHTML = '<option value="">Select language to learn</option>';
      languages.forEach(lang => {
        const option = createElement('option');
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
        const option = createElement('option');
        option.value = lang.code;
        option.textContent = `${lang.flag} ${lang.name}`;
        learnLangEl.appendChild(option);
      });

      // Add unavailable languages with indication
      if (unavailableLanguages.length > 0) {
        const separator = createElement('option');
        separator.disabled = true;
        separator.textContent = '─── Limited support ───';
        learnLangEl.appendChild(separator);

        unavailableLanguages.forEach(lang => {
          const option = createElement('option', '', { color: '#9ca3af' });
          option.value = lang.code;
          option.textContent = `${lang.flag} ${lang.name} (limited)`;
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
          const option = createElement('option');
          option.value = lang.code;
          option.textContent = `${lang.flag} ${lang.name}`;
          learnLangEl.appendChild(option);
        }
      });
    } finally {
      learnLangEl.disabled = false;
    }
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


