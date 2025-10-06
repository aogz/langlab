import { languages, populateLanguageSelect, checkLanguagePairAvailability } from './utils.js';

(() => {
  const nativeSelect = document.getElementById('nativeLanguage');
  const learningSelect = document.getElementById('learningLanguage');
  const setupForm = document.getElementById('setupForm');
  const saveBtn = document.getElementById('saveBtn');
  const skipBtn = document.getElementById('skipBtn');
  const availabilityStatus = document.getElementById('availabilityStatus');

  // Update learning language options based on native language selection
  async function updateLearningLanguageOptions(currentLearningLang) {
    const selectedNativeLang = nativeSelect.value;
    
    if (!selectedNativeLang) {
      // Reset to all languages
      learningSelect.innerHTML = '<option value="">Select language to learn</option>';
      languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang.code;
        option.textContent = `${lang.flag} ${lang.name}`;
        learningSelect.appendChild(option);
      });
      return;
    }

    // Show loading state
    learningSelect.innerHTML = '<option value="">Checking available languages...</option>';
    learningSelect.disabled = true;
    availabilityStatus.style.display = 'block';

    try {
      // Check availability for each language pair
      const availabilityPromises = languages.map(async (lang) => {
        if (lang.code === selectedNativeLang) return null; // Skip same language
        
        const availability = await checkLanguagePairAvailability(selectedNativeLang, lang.code);
        return { lang, availability };
      });

      const results = await Promise.all(availabilityPromises);
      
      // Filter and populate options
      learningSelect.innerHTML = '<option value="">Select language to learn</option>';
      
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
        learningSelect.appendChild(option);
      });

      // Add unavailable languages with indication
      if (unavailableLanguages.length > 0) {
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '─── Limited support ───';
        learningSelect.appendChild(separator);

        unavailableLanguages.forEach(lang => {
          const option = document.createElement('option');
          option.value = lang.code;
          option.textContent = `${lang.flag} ${lang.name} (limited)`;
          option.style.color = '#9ca3af';
          learningSelect.appendChild(option);
        });
      }

      // Restore previous selection if still available
      if (currentLearningLang && learningSelect.querySelector(`option[value="${currentLearningLang}"]`)) {
        learningSelect.value = currentLearningLang;
      }

    } catch (error) {
      console.error('Failed to check language availability:', error);
      // Fallback to showing all languages
      learningSelect.innerHTML = '<option value="">Select language to learn</option>';
      languages.forEach(lang => {
        if (lang.code !== selectedNativeLang) {
          const option = document.createElement('option');
          option.value = lang.code;
          option.textContent = `${lang.flag} ${lang.name}`;
          learningSelect.appendChild(option);
        }
      });
    } finally {
      learningSelect.disabled = false;
      availabilityStatus.style.display = 'none';
    }
  }

  // Load existing settings from storage
  async function loadExistingSettings() {
    try {
      const result = await chrome.storage.local.get(['weblangUserLang', 'weblangLearnLang']);
      
      if (result.weblangUserLang) {
        nativeSelect.value = result.weblangUserLang;
      }
      
      if (result.weblangLearnLang) {
        learningSelect.value = result.weblangLearnLang;
      }
      return result;
    } catch (error) {
      console.warn('Failed to load existing settings:', error);
      return {};
    }
  }

  // Auto-detect user's language preference (only if no existing settings)
  function detectUserLanguage() {
    // Only auto-detect if no existing settings are loaded
    if (nativeSelect.value) return;
    
    const browserLang = navigator.language.split('-')[0];
    const detectedLang = languages.find(lang => lang.code === browserLang);
    
    if (detectedLang) {
      nativeSelect.value = detectedLang.code;
    }
  }

  // Save settings to storage
  function saveSettings() {
    const nativeLang = nativeSelect.value;
    const learningLang = learningSelect.value;

    if (!nativeLang && !learningLang) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      chrome.storage.local.set({
        weblangUserLang: nativeLang,
        weblangLearnLang: learningLang,
        weblangSetupCompleted: true,
        weblangSetupDate: Date.now()
      }, () => {
        // Notify other parts of the extension that language settings have been updated
        try {
          chrome.runtime.sendMessage({ type: 'LANGUAGE_SETTINGS_UPDATED' });
        } catch (error) {
          console.warn('Failed to notify language settings update:', error);
        }
        resolve();
      });
    });
  }

  // Handle form submission
  async function handleSubmit(e) {
    e.preventDefault();
    
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
      await saveSettings();
      
      // Close the setup window
      if (chrome.tabs) {
        // If opened as a tab, close it
        const currentTab = await chrome.tabs.getCurrent();
        if (currentTab) {
          chrome.tabs.remove(currentTab.id);
        }
      } else {
        // If opened as a popup, close it
        window.close();
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      saveBtn.textContent = 'Get Started';
      saveBtn.disabled = false;
    }
  }

  // Handle skip button
  async function handleSkip() {
    skipBtn.textContent = 'Skipping...';
    skipBtn.disabled = true;

    try {
      await saveSettings();
      
      // Close the setup window
      if (chrome.tabs) {
        const currentTab = await chrome.tabs.getCurrent();
        if (currentTab) {
          chrome.tabs.remove(currentTab.id);
        }
      } else {
        window.close();
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      skipBtn.textContent = 'Skip for now';
      skipBtn.disabled = false;
    }
  }

  // Initialize the setup page
  async function init() {
    populateLanguageSelect(nativeSelect, 'Select your native language');
    populateLanguageSelect(learningSelect, 'Select language to learn');
    
    // Load existing settings first
    const existingSettings = await loadExistingSettings();
    
    // Auto-detect user's language only if no existing settings
    detectUserLanguage();

    // If a native language is already selected, update the learning language options
    if (nativeSelect.value) {
      await updateLearningLanguageOptions(existingSettings.weblangLearnLang);
    }
    
    // Enable/disable save button based on form validity
    function updateSaveButton() {
      const isValid = nativeSelect.value && learningSelect.value;
      saveBtn.disabled = !isValid;
    }
    
    // Initial button state
    updateSaveButton();

    // Add event listeners LAST, after initial state is set.
    setupForm.addEventListener('submit', handleSubmit);
    skipBtn.addEventListener('click', handleSkip);
    
    // Update learning language options when native language changes
    nativeSelect.addEventListener('change', async () => {
      updateSaveButton();
      await updateLearningLanguageOptions();
    });
    
    learningSelect.addEventListener('change', updateSaveButton);
  }

  // Start the setup process
  init();
})();
