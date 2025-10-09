import { populateLanguageSelect, getDomainFromUrl } from './utils.js';

const nativeLanguageSelect = document.getElementById('native-language');
const learningLanguageSelect = document.getElementById('learning-language');
const ignoreSiteButton = document.getElementById('ignore-site');
const openSidebarButton = document.getElementById('open-sidebar');

populateLanguageSelect(nativeLanguageSelect, 'Select Native Language');
populateLanguageSelect(learningLanguageSelect, 'Select Learning Language');

async function loadSettings() {
  const result = await chrome.storage.local.get(['weblangUserLang', 'weblangLearnLang', 'ignoreList']);
  if (result.weblangUserLang) {
    nativeLanguageSelect.value = result.weblangUserLang;
  }
  if (result.weblangLearnLang) {
    learningLanguageSelect.value = result.weblangLearnLang;
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

nativeLanguageSelect.addEventListener('change', () => {
  chrome.storage.local.set({ weblangUserLang: nativeLanguageSelect.value });
});

learningLanguageSelect.addEventListener('change', () => {
  chrome.storage.local.set({ weblangLearnLang: learningLanguageSelect.value });
});

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

document.addEventListener('DOMContentLoaded', loadSettings);
