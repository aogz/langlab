(() => {
  const userLangEl = document.getElementById('userLang');
  const learnLangEl = document.getElementById('learnLang');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusEl = document.getElementById('status');

  function showStatus(msg) {
    statusEl.textContent = msg || '';
    if (!msg) return;
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
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
    const userLang = (userLangEl.value || '').trim().toLowerCase();
    const learnLang = (learnLangEl.value || '').trim().toLowerCase();
    try {
      if (!chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ weblangUserLang: userLang, weblangLearnLang: learnLang }, () => {
        showStatus('Saved');
      });
    } catch {}
  }

  function reset() {
    userLangEl.value = '';
    learnLangEl.value = '';
    try {
      if (!chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.remove(['weblangUserLang', 'weblangLearnLang'], () => {
        showStatus('Reset');
      });
    } catch {}
  }

  saveBtn.addEventListener('click', save);
  resetBtn.addEventListener('click', reset);
  load();
})();


