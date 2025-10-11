import { getDomainFromUrl } from './utils.js';

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

document.addEventListener('DOMContentLoaded', loadSettings);
