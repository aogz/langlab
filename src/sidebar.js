(() => {
  const wordsEl = document.getElementById('words');
  const translationEl = document.getElementById('translation');
  const controlsEl = document.getElementById('controls');

  let selectedWords = [];
  let isDragging = false;
  let selectionStartIndex = null;
  let wordOrder = [];
  const translatorCache = new Map();
  let languageDetectorPromise = null;

  function setTranslationLoading(msg) {
    translationEl.textContent = msg || 'Translating…';
  }

  function setTranslation(text) {
    translationEl.textContent = text || 'Translation not available.';
  }

  function buildControls(detected) {
    controlsEl.innerHTML = '';
    const lang = document.createElement('button');
    lang.className = 'btn-lang';
    lang.textContent = detected || 'unknown';

    const center = document.createElement('div');
    center.style.display = 'flex';
    center.style.justifyContent = 'center';
    center.style.gap = '8px';
    const ask = document.createElement('button');
    ask.className = 'btn btn-primary';
    ask.textContent = 'Ask me a question';
    const grammar = document.createElement('button');
    grammar.className = 'btn btn-secondary';
    grammar.textContent = 'Explain Grammar';
    center.appendChild(ask);
    center.appendChild(grammar);

    const openPopup = document.createElement('button');
    openPopup.className = 'btn btn-secondary';
    openPopup.textContent = 'Open in popup';
    openPopup.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'WEBLANG_SET_PREFER_SIDEBAR', preferSidebar: false });
    });

    controlsEl.appendChild(openPopup);
    controlsEl.appendChild(center);
    controlsEl.appendChild(lang);
  }

  async function getLanguageDetector(onProgress) {
    if (!('LanguageDetector' in self)) return null;
    if (languageDetectorPromise) return languageDetectorPromise;
    languageDetectorPromise = (async () => {
      try {
        if (typeof self.LanguageDetector.availability === 'function') {
          try { await self.LanguageDetector.availability(); } catch {}
        }
        const det = await self.LanguageDetector.create({
          monitor(m) {
            if (!m || typeof m.addEventListener !== 'function') return;
            m.addEventListener('downloadprogress', (e) => {
              try { onProgress && onProgress(`Preparing language model… ${Math.round((e.loaded||0)*100)}%`); } catch {}
            });
          }
        });
        return det;
      } catch { return null; }
    })();
    return languageDetectorPromise;
  }

  async function detectLanguageCode(text, onProgress) {
    try {
      const det = await getLanguageDetector(onProgress);
      if (!det) return 'unknown';
      const results = await det.detect(String(text||''));
      if (Array.isArray(results) && results.length > 0) {
        const top = results[0];
        if (top && top.detectedLanguage) return top.detectedLanguage;
      }
      return 'unknown';
    } catch { return 'unknown'; }
  }

  async function getTranslator(sourceLanguage, targetLanguage, onProgress) {
    if (!('Translator' in self)) return null;
    const key = `${sourceLanguage}-${targetLanguage}`;
    if (translatorCache.has(key)) return translatorCache.get(key);
    const promise = (async () => {
      try {
        if (typeof self.Translator.availability === 'function') {
          try { await self.Translator.availability({ sourceLanguage, targetLanguage }); } catch {}
        }
        const translator = await self.Translator.create({
          sourceLanguage,
          targetLanguage,
          monitor(m) {
            if (!m || typeof m.addEventListener !== 'function') return;
            m.addEventListener('downloadprogress', (e) => {
              try { onProgress && onProgress(`Downloading translation model… ${Math.round((e.loaded||0)*100)}%`); } catch {}
            });
          }
        });
        return translator;
      } catch { return null; }
    })();
    translatorCache.set(key, promise);
    return promise;
  }

  async function translate(text, targetLang = 'en', onProgress) {
    try {
      const detected = await detectLanguageCode(text, onProgress);
      const translator = await getTranslator(detected || 'auto', targetLang, onProgress);
      if (!translator) return null;
      const result = await translator.translate(text);
      return typeof result === 'string' ? result : (result && (result.translation || result.translatedText || ''));
    } catch { return null; }
  }

  function renderClickableWords(text) {
    wordsEl.innerHTML = '';
    selectedWords = [];
    isDragging = false;
    selectionStartIndex = null;
    wordOrder = [];
    const parts = String(text||'').split(/(\s+)/);
    parts.forEach((part) => {
      if (part.trim() === '') { wordsEl.appendChild(document.createTextNode(part)); return; }
      const cleanWord = part.replace(/[^\w\s'-]/g, '').trim();
      const span = document.createElement('span');
      span.textContent = part;
      span.style.cursor = 'pointer';
      span.style.transition = 'color 150ms ease-in-out, background 150ms ease-in-out';
      span.style.borderBottom = '1px dashed rgba(156,163,175,0.6)';
      span.style.display = 'inline-block';
      span.style.padding = '0 2px';
      const currentIndex = wordOrder.length;
      if (cleanWord) wordOrder.push({ word: cleanWord, span });
      span.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation(); if (!cleanWord) return;
        isDragging = true; selectedWords = [cleanWord]; selectionStartIndex = currentIndex;
        highlightSelection([span]);
      });
      span.addEventListener('mouseenter', (e) => {
        if (!isDragging || selectionStartIndex === null) return; e.preventDefault(); e.stopPropagation();
        const min = Math.min(selectionStartIndex, currentIndex); const max = Math.max(selectionStartIndex, currentIndex);
        const seq = wordOrder.slice(min, max+1);
        selectedWords = seq.map(w=>w.word);
        highlightSelection(seq.map(w=>w.span));
      });
      wordsEl.appendChild(span);
    });
  }

  function clearHighlights() {
    wordOrder.forEach(({ span }) => { span.style.background = ''; span.style.color = ''; span.style.borderBottom = '1px dashed rgba(156,163,175,0.6)'; });
  }
  function highlightSelection(spans) {
    clearHighlights();
    spans.forEach((s) => { s.style.background = '#2563eb'; s.style.color = '#fff'; s.style.borderBottom = 'none'; s.style.borderRadius = '4px'; });
  }

  document.addEventListener('mouseup', async () => {
    if (!isDragging) return; isDragging = false;
    if (selectedWords.length === 0) return;
    const text = selectedWords.join(' ');
    buildControls('detecting…');
    setTranslationLoading('Translating…');
    const res = await translate(text, 'en', (msg)=>{ try { setTranslationLoading(msg); } catch {} });
    setTranslation(res || 'Translation not available.');
    const lang = await detectLanguageCode(text);
    buildControls(lang || 'unknown');
  });

  function setWords(text) {
    renderClickableWords(text || '');
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'WEBLANG_SIDEBAR_SELECTION') {
      const { text } = msg;
      setWords(text || '');
      buildControls('detecting…');
      setTranslation('');
    }
  });

  // Mark preference so subsequent selections route to sidebar
  try {
    chrome.runtime && chrome.runtime.sendMessage({ type: 'WEBLANG_SET_PREFER_SIDEBAR', preferSidebar: true });
  } catch {}

  // On load, try to fetch last selection from storage
  try {
    chrome.storage && chrome.storage.local && chrome.storage.local.get(['weblangSidebarSelection'], (res) => {
      const sel = res && res.weblangSidebarSelection;
      if (sel && sel.text) {
        setWords(sel.text);
        buildControls('detecting…');
        setTranslation('');
      }
    });
  } catch {}
})();


