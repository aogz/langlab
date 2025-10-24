import { getDomainFromUrl } from './utils.js';

const activateExtensionButton = document.getElementById('activate-extension');
const ignoreSiteButton = document.getElementById('ignore-site');
const openSidebarButton = document.getElementById('open-sidebar');
const setupStatus = document.getElementById('setupStatus');
const setupNativeLang = document.getElementById('setupNativeLang');
const setupLearningLang = document.getElementById('setupLearningLang');
const setupChangeBtn = document.getElementById('setupChangeBtn');

async function loadSettings() {
  const result = await chrome.storage.local.get(['weblangUserLang', 'weblangLearnLang', 'ignoreList', 'weblangSetupCompleted']);
  
  if (result.weblangSetupCompleted && result.weblangUserLang && result.weblangLearnLang) {
    setupStatus.style.display = 'block';
    const nativeLangName = getLanguageName(result.weblangUserLang);
    const learningLangName = getLanguageName(result.weblangLearnLang);
    setupNativeLang.textContent = nativeLangName;
    setupLearningLang.textContent = learningLangName;
  } else {
    setupStatus.style.display = 'none';
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    const domain = getDomainFromUrl(tab.url);
    const ignoreList = result.ignoreList || [];
    if (domain && ignoreList.includes(domain)) {
      ignoreSiteButton.textContent = '✅ Unignore Site';
    } else {
      ignoreSiteButton.textContent = '🚫 Ignore Site';
    }
  }
}

function getLanguageName(code) {
  const languageMap = {
      'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian',
      'pt': 'Portuguese', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
      'ar': 'Arabic', 'hi': 'Hindi', 'nl': 'Dutch', 'sv': 'Swedish', 'no': 'Norwegian',
      'da': 'Danish', 'fi': 'Finnish', 'pl': 'Polish', 'cs': 'Czech', 'hu': 'Hungarian',
      'ro': 'Romanian', 'bg': 'Bulgarian', 'hr': 'Croatian', 'sk': 'Slovak', 'sl': 'Slovenian',
      'et': 'Estonian', 'lv': 'Latvian', 'lt': 'Lithuanian', 'el': 'Greek', 'tr': 'Turkish',
      'he': 'Hebrew', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian', 'ms': 'Malay',
      'tl': 'Filipino', 'uk': 'Ukrainian', 'be': 'Belarusian', 'ka': 'Georgian', 'hy': 'Armenian',
      'az': 'Azerbaijani', 'kk': 'Kazakh', 'ky': 'Kyrgyz', 'uz': 'Uzbek', 'mn': 'Mongolian',
      'ne': 'Nepali', 'si': 'Sinhala', 'ta': 'Tamil', 'te': 'Telugu', 'ml': 'Malayalam',
      'kn': 'Kannada', 'gu': 'Gujarati', 'pa': 'Punjabi', 'bn': 'Bengali', 'ur': 'Urdu',
      'fa': 'Persian', 'ps': 'Pashto', 'sw': 'Swahili', 'am': 'Amharic', 'yo': 'Yoruba',
      'ig': 'Igbo', 'ha': 'Hausa', 'zu': 'Zulu', 'af': 'Afrikaans', 'is': 'Icelandic',
      'ga': 'Irish', 'cy': 'Welsh', 'mt': 'Maltese', 'eu': 'Basque', 'ca': 'Catalan', 'gl': 'Galician'
  };
  return languageMap[code] || code.toUpperCase();
}

ignoreSiteButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    const domain = getDomainFromUrl(tab.url);
    if (domain) {
      const result = await chrome.storage.local.get({ ignoreList: [] });
      let ignoreList = result.ignoreList;
      if (ignoreList.includes(domain)) {
        ignoreList = ignoreList.filter(d => d !== domain);
        await chrome.storage.local.set({ ignoreList: ignoreList });
        ignoreSiteButton.textContent = '🚫 Ignore Site';
      } else {
        ignoreList.push(domain);
        await chrome.storage.local.set({ ignoreList: ignoreList });
        ignoreSiteButton.textContent = '✅ Unignore Site';
      }
    }
  }
});

openSidebarButton.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.sidePanel.open({ tabId: tabs[0].id });
    }
  });
});

setupChangeBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

activateExtensionButton.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      // Check if this is a valid page for content scripts
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
        activateExtensionButton.textContent = '❌ Not supported on this page';
        activateExtensionButton.disabled = true;
        setTimeout(() => {
          activateExtensionButton.textContent = '🎯 Activate on Page';
          activateExtensionButton.disabled = false;
        }, 3000);
        return;
      }

      // Try to send message to content script
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE' });
        
        // Update button text to show it's activated
        activateExtensionButton.textContent = '✅ Activated';
        activateExtensionButton.disabled = true;
        
        // Reset button after 2 seconds
        setTimeout(() => {
          activateExtensionButton.textContent = '🎯 Activate on Page';
          activateExtensionButton.disabled = false;
        }, 2000);
      } catch (messageError) {
        // If content script isn't loaded, try to inject it
        console.log('Content script not found, attempting to inject...');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          
          // Wait a bit for the script to load, then try again
          setTimeout(async () => {
            try {
              await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE' });
              activateExtensionButton.textContent = '✅ Activated';
              activateExtensionButton.disabled = true;
              setTimeout(() => {
                activateExtensionButton.textContent = '🎯 Activate on Page';
                activateExtensionButton.disabled = false;
              }, 2000);
            } catch (retryError) {
              console.error('Failed to activate after injection:', retryError);
              activateExtensionButton.textContent = '❌ Failed to activate';
              activateExtensionButton.disabled = true;
              setTimeout(() => {
                activateExtensionButton.textContent = '🎯 Activate on Page';
                activateExtensionButton.disabled = false;
              }, 3000);
            }
          }, 500);
        } catch (injectionError) {
          console.error('Failed to inject content script:', injectionError);
          activateExtensionButton.textContent = '❌ Cannot activate on this page';
          activateExtensionButton.disabled = true;
          setTimeout(() => {
            activateExtensionButton.textContent = '🎯 Activate on Page';
            activateExtensionButton.disabled = false;
          }, 3000);
        }
      }
    }
  } catch (error) {
    console.error('Failed to activate extension:', error);
    // Show error state briefly
    activateExtensionButton.textContent = '❌ Failed';
    activateExtensionButton.disabled = true;
    
    setTimeout(() => {
      activateExtensionButton.textContent = '🎯 Activate on Page';
      activateExtensionButton.disabled = false;
    }, 2000);
  }
});

document.addEventListener('DOMContentLoaded', loadSettings);
