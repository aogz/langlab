// Lightweight interactive word selection and popup translation using on-device Translator API
// No backend calls; runs entirely in content context.

(() => {
  const EXT_CLS_PREFIX = 'weblang-ext';
  const ACTIVATION_MODIFIER = 'altKey'; // Hold Alt/Option to activate overlay on arbitrary blocks

  let isDragging = false;
  let selectionStartIndex = null;
  let wordOrder = [];
  let selectedWords = [];
  let popupEl = null;
  let textContainer = null;
  let translationBodyEl = null;
  const clickableNodes = new WeakSet();
  const translatorCache = new Map(); // key: `${source}-${target}` -> Promise<Translator>
  let activeParagraphEl = null;
  let hoverOverlayEl = null;
  let backdropEl = null;
  let languageDetectorPromise = null;
  let popupBodyRef = null;
  let popupWordsContainerEl = null;
  let overlayWordsContainerEl = null;
  let tipEl = null;
  let isDraggingPopup = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let popupContentEl = null;
  let isPopupCollapsed = false;
  let dragListenersAttached = false;
  let currentDetectedLanguage = 'unknown';

  function attachDragListeners() {
    if (dragListenersAttached) return;
    document.addEventListener('mousemove', (e) => {
      if (!isDraggingPopup || !popupEl) return;
      try {
        const newLeft = e.clientX - dragOffsetX;
        const newTop = e.clientY - dragOffsetY;
        popupEl.style.left = `${Math.max(4, Math.min(window.innerWidth - 40, newLeft))}px`;
        popupEl.style.top = `${Math.max(4, Math.min(window.innerHeight - 40, newTop))}px`;
      } catch {}
    }, true);
    document.addEventListener('mouseup', () => { isDraggingPopup = false; }, true);
    dragListenersAttached = true;
  }

  function isInteractiveTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('input, button, textarea, select, a, [contenteditable], .weblang-ext-word, .weblang-ext-tip, .weblang-ext-controls');
  }

  function getDocumentLanguage() {
    const htmlLang = (document.documentElement && document.documentElement.lang || '').trim();
    if (htmlLang) return htmlLang.toLowerCase();
    // Try common meta
    const metaLang = document.querySelector('meta[http-equiv="content-language" i]');
    if (metaLang && metaLang.content) return metaLang.content.split(',')[0].trim().toLowerCase();
    const navLang = (navigator.language || '').trim();
    if (navLang) return navLang.toLowerCase();
    return 'en';
  }

  async function saveWordToVocab(translationText) {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        throw new Error('Storage not available');
      }

      // Get the selected word from the current selection
      const selectedWord = selectedWords.join(' ') || '';
      if (!selectedWord || !translationText) {
        throw new Error('No word or translation to save');
      }

      const currentUrl = window.location.href;
      const urlKey = `weblang_vocab_${btoa(currentUrl).replace(/[^a-zA-Z0-9]/g, '')}`;
      
      // Get existing vocabulary for this URL
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get([urlKey], (data) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(data);
          }
        });
      });

      const existingVocab = result[urlKey] || [];
      
      // Check if word already exists
      const existingEntry = existingVocab.find(entry => 
        entry.word.toLowerCase() === selectedWord.toLowerCase()
      );

      if (existingEntry) {
        // Update existing entry
        existingEntry.translation = translationText;
        existingEntry.lastSaved = Date.now();
      } else {
        // Add new entry
        existingVocab.push({
          word: selectedWord,
          translation: translationText,
          url: currentUrl,
          savedAt: Date.now(),
          lastSaved: Date.now()
        });
      }

      // Save back to storage
      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [urlKey]: existingVocab }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });

      console.log('Word saved to vocabulary:', { word: selectedWord, translation: translationText, url: currentUrl });
      
      // Wait for language detection to complete, then save to sidebar
      let detectedLanguage = currentDetectedLanguage;
      if (window.currentLanguageDetectionPromise) {
        try {
          detectedLanguage = await window.currentLanguageDetectionPromise;
          console.log('Language detection completed:', detectedLanguage);
        } catch (error) {
          console.error('Error waiting for language detection:', error);
        }
      }
      console.log('Saving words with language:', detectedLanguage);
      await saveWordsToSidebar(selectedWords, currentUrl, document.title, translationText, detectedLanguage);
      
      // Return result for UI feedback
      return {
        success: true,
        isNewWord: !existingEntry,
        word: selectedWord
      };
    } catch (error) {
      console.error('Failed to save word to vocabulary:', error);
      throw error;
    }
  }

  // New function to save words to sidebar storage
  async function saveWordsToSidebar(words, url, title, translation, sourceLanguage) {
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
        sourceLanguage: sourceLanguage || 'unknown'
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

  // Helper function to get domain from URL
  function getDomainFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  }



  async function getVocabForUrl(url = null) {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        return [];
      }

      const targetUrl = url || window.location.href;
      const urlKey = `weblang_vocab_${btoa(targetUrl).replace(/[^a-zA-Z0-9]/g, '')}`;
      
      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get([urlKey], (data) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(data);
          }
        });
      });

      return result[urlKey] || [];
    } catch (error) {
      console.error('Failed to get vocabulary for URL:', error);
      return [];
    }
  }

  async function getAllVocabUrls() {
    try {
      if (!chrome.storage || !chrome.storage.local) {
        return [];
      }

      const result = await new Promise((resolve, reject) => {
        chrome.storage.local.get(null, (data) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(data);
          }
        });
      });

      const vocabUrls = [];
      for (const key in result) {
        if (key.startsWith('weblang_vocab_') && Array.isArray(result[key]) && result[key].length > 0) {
          const url = result[key][0]?.url || 'Unknown URL';
          vocabUrls.push({
            url: url,
            key: key,
            count: result[key].length,
            lastSaved: Math.max(...result[key].map(entry => entry.lastSaved || entry.savedAt || 0))
          });
        }
      }

      return vocabUrls.sort((a, b) => b.lastSaved - a.lastSaved);
    } catch (error) {
      console.error('Failed to get all vocabulary URLs:', error);
      return [];
    }
  }

  async function getTranslator(sourceLanguage, targetLanguage, onProgress) {
    if (!('Translator' in self)) return null;
    const key = `${sourceLanguage}-${targetLanguage}`;
    if (translatorCache.has(key)) return translatorCache.get(key);

    const promise = (async () => {
      try {
        // Optional: check availability (may return 'available' or 'downloadable')
        if (typeof self.Translator.availability === 'function') {
          try {
            await self.Translator.availability({ sourceLanguage, targetLanguage });
          } catch (e) {
            // proceed; create() will handle download and readiness
          }
        }

        const translator = await self.Translator.create({
          sourceLanguage,
          targetLanguage,
          monitor(monitor) {
            if (!onProgress || !monitor || typeof monitor.addEventListener !== 'function') return;
            monitor.addEventListener('downloadprogress', (e) => {
              try {
                const pct = Math.round((e.loaded || 0) * 100);
                onProgress(`Downloading translation model… ${pct}%`);
              } catch {}
            });
          }
        });
        return translator;
      } catch (err) {
        return null;
      }
    })();

    translatorCache.set(key, promise);
    return promise;
  }

  function ensureContainer() {
    if (textContainer && document.body.contains(textContainer)) return textContainer;
    textContainer = document.createElement('div');
    textContainer.className = `${EXT_CLS_PREFIX}-container`;
    textContainer.style.all = 'initial';
    textContainer.style.position = 'fixed';
    textContainer.style.inset = '0px';
    textContainer.style.pointerEvents = 'none';
    textContainer.style.zIndex = '2147483647';
    document.documentElement.appendChild(textContainer);
    return textContainer;
  }

  function clearPopup() {
    if (popupEl && popupEl.parentNode) popupEl.parentNode.removeChild(popupEl);
    popupEl = null;
    if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
    backdropEl = null;
    popupBodyRef = null;
  }

  function ensureBackdrop() {
    const container = ensureContainer();
    if (backdropEl && container.contains(backdropEl)) return backdropEl;
    backdropEl = document.createElement('div');
    backdropEl.className = `${EXT_CLS_PREFIX}-backdrop`;
    backdropEl.style.position = 'fixed';
    backdropEl.style.inset = '0';
    backdropEl.style.pointerEvents = 'none';
    backdropEl.style.backdropFilter = 'none';
    backdropEl.style.webkitBackdropFilter = 'none';
    backdropEl.style.background = 'transparent';
    backdropEl.style.zIndex = '2147483646';
    container.appendChild(backdropEl);
    return backdropEl;
  }

  function clearTip() {
    try {
      if (tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    } catch {}
    tipEl = null;
    // Also clear current word selection highlight when the tip is closed
    try {
      selectionStartIndex = null;
    } catch {}
  }

  function createTipPopover(position, text, isTranslating) {
    clearTip();
    const container = ensureContainer();
    tipEl = document.createElement('div');
    tipEl.className = `${EXT_CLS_PREFIX}-tip`;
    tipEl.style.position = 'fixed';
    tipEl.style.left = `${position.x}px`;
    tipEl.style.top = `${position.y}px`;
    tipEl.style.transform = position.transform;
    tipEl.style.width = '280px';
    tipEl.style.pointerEvents = 'auto';
    tipEl.style.background = 'rgba(17,24,39,0.98)';
    tipEl.style.color = '#e5e7eb';
    tipEl.style.borderRadius = '8px';
    tipEl.style.boxShadow = '0 12px 24px rgba(0,0,0,0.25)';
    tipEl.style.padding = '6px';
    tipEl.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif';
    tipEl.style.zIndex = '2147483647';

    // Use global selectedWords state
    const selectedWord = selectedWords.join(' ') || '';
    
    if (selectedWord && !isTranslating) {
      const wordHeader = document.createElement('div');
      wordHeader.style.fontSize = '11px';
      wordHeader.style.color = 'rgba(209,213,219,0.8)';
      wordHeader.style.marginBottom = '3px';
      wordHeader.style.fontWeight = '500';
      wordHeader.textContent = `"${selectedWord}"`;
      tipEl.appendChild(wordHeader);
    }

    const body = document.createElement('div');
    body.style.fontSize = '13px';
    body.style.color = '#e5e7eb';
    body.style.wordBreak = 'break-word';
    body.style.marginBottom = '6px';

    if (isTranslating) {
      body.textContent = 'Translating…';
    } else {
      body.textContent = text || '';
    }

    tipEl.appendChild(body);

    // Add save button if we have translation text and selected word
    if (!isTranslating && text && text.trim() && selectedWord) {
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Add to Vocab';
      saveBtn.style.width = '100%';
      saveBtn.style.padding = '4px 6px';
      saveBtn.style.background = '#2563eb';
      saveBtn.style.border = 'none';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderRadius = '4px';
      saveBtn.style.fontSize = '11px';
      saveBtn.style.cursor = 'pointer';
      saveBtn.style.marginTop = '4px';
      saveBtn.style.fontWeight = '500';
      
      saveBtn.addEventListener('click', async () => {
        try {
          const result = await saveWordToVocab(text.trim());
          if (result.success) {
            if (result.isNewWord) {
              saveBtn.textContent = 'Added!';
              saveBtn.style.background = '#10b981';
            } else {
              saveBtn.textContent = 'Updated!';
              saveBtn.style.background = '#f59e0b';
            }
            setTimeout(() => {
              saveBtn.textContent = 'Add to Vocab';
              saveBtn.style.background = '#2563eb';
            }, 1500);
          } else {
            saveBtn.textContent = 'Already exists';
            saveBtn.style.background = '#6b7280';
            setTimeout(() => {
              saveBtn.textContent = 'Add to Vocab';
              saveBtn.style.background = '#2563eb';
            }, 1500);
          }
        } catch (error) {
          saveBtn.textContent = 'Error';
          saveBtn.style.background = '#ef4444';
          setTimeout(() => {
            saveBtn.textContent = 'Add to Vocab';
            saveBtn.style.background = '#2563eb';
          }, 1500);
        }
      });
      
      tipEl.appendChild(saveBtn);
    }
    container.appendChild(tipEl);
    return { bodyEl: body };
  }

  function setOverlayTranslationLoading(message) {
    if (!translationBodyEl) return;
    translationBodyEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';
    wrapper.style.padding = '6px 8px';
    wrapper.style.border = '1px dashed rgba(75,85,99,0.7)';
    wrapper.style.borderRadius = '10px';
    wrapper.style.background = 'rgba(31,41,55,0.6)';
    const dot = document.createElement('div');
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '9999px';
    dot.style.background = '#60a5fa';
    dot.style.opacity = '0.9';
    const text = document.createElement('div');
    text.style.fontSize = '16px';
    text.style.color = '#e5e7eb';
    text.textContent = message || 'Translating…';
    wrapper.appendChild(dot);
    wrapper.appendChild(text);
    translationBodyEl.appendChild(wrapper);
  }

  function setOverlayTranslationResult(resultText) {
    if (!translationBodyEl) return;
    translationBodyEl.innerHTML = '';
    const card = document.createElement('div');
    card.style.border = '1px solid rgba(75,85,99,0.9)';
    card.style.background = 'rgba(17,24,39,0.9)';
    card.style.borderRadius = '12px';
    card.style.padding = '12px 14px';
    card.style.boxShadow = '0 8px 22px rgba(0,0,0,0.30)';

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.justifyContent = 'space-between';
    titleRow.style.marginBottom = '8px';

    const title = document.createElement('span');
    title.textContent = 'Translation';
    title.style.fontSize = '13px';
    title.style.letterSpacing = '0.3px';
    title.style.color = 'rgba(209,213,219,0.9)';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.padding = '6px 10px';
    copyBtn.style.background = '#2563eb';
    copyBtn.style.color = '#fff';
    copyBtn.style.border = 'none';
    copyBtn.style.borderRadius = '8px';
    copyBtn.style.cursor = 'pointer';
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(resultText || ''); copyBtn.textContent = 'Copied!'; setTimeout(() => copyBtn.textContent = 'Copy', 1200); } catch {}
    });

    const hr = document.createElement('div');
    hr.style.height = '1px';
    hr.style.background = 'rgba(75,85,99,0.6)';
    hr.style.margin = '4px 0 8px 0';

    const text = document.createElement('div');
    text.style.fontSize = '18px';
    text.style.lineHeight = '1.7';
    text.style.color = '#f3f4f6';
    text.style.whiteSpace = 'pre-wrap';
    text.style.wordBreak = 'break-word';
    text.textContent = resultText || 'Translation not available.';

    titleRow.appendChild(title);
    titleRow.appendChild(copyBtn);
    card.appendChild(titleRow);
    card.appendChild(hr);
    card.appendChild(text);

    // Add save to vocab button if we have translation text and selected word
    if (resultText && resultText.trim() && selectedWords.length > 0) {
      const selectedWord = selectedWords.join(' ');
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Add to Vocab';
      saveBtn.style.width = '100%';
      saveBtn.style.padding = '8px 12px';
      saveBtn.style.background = '#10b981';
      saveBtn.style.border = 'none';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderRadius = '8px';
      saveBtn.style.fontSize = '13px';
      saveBtn.style.cursor = 'pointer';
      saveBtn.style.marginTop = '12px';
      saveBtn.style.fontWeight = '500';
      
      saveBtn.addEventListener('click', async () => {
        try {
          const result = await saveWordToVocab(resultText.trim());
          if (result.success) {
            if (result.isNewWord) {
              saveBtn.textContent = 'Added!';
              saveBtn.style.background = '#059669';
            } else {
              saveBtn.textContent = 'Updated!';
              saveBtn.style.background = '#f59e0b';
            }
            setTimeout(() => {
              saveBtn.textContent = 'Add to Vocab';
              saveBtn.style.background = '#10b981';
            }, 1500);
          } else {
            saveBtn.textContent = 'Already exists';
            saveBtn.style.background = '#6b7280';
            setTimeout(() => {
              saveBtn.textContent = 'Add to Vocab';
              saveBtn.style.background = '#10b981';
            }, 1500);
          }
        } catch (error) {
          saveBtn.textContent = 'Error';
          saveBtn.style.background = '#ef4444';
          setTimeout(() => {
            saveBtn.textContent = 'Add to Vocab';
            saveBtn.style.background = '#10b981';
          }, 1500);
        }
      });
      
      card.appendChild(saveBtn);
    }

    translationBodyEl.appendChild(card);
  }

  function setOverlayTitledCard(titleText, bodyText) {
    if (!translationBodyEl) return;
    translationBodyEl.innerHTML = '';
    const card = document.createElement('div');
    card.style.border = '1px solid rgba(75,85,99,0.9)';
    card.style.background = 'rgba(17,24,39,0.9)';
    card.style.borderRadius = '12px';
    card.style.padding = '12px 14px';
    card.style.boxShadow = '0 8px 22px rgba(0,0,0,0.30)';

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.justifyContent = 'space-between';
    titleRow.style.marginBottom = '8px';

    const title = document.createElement('span');
    title.textContent = titleText || '';
    title.style.fontSize = '13px';
    title.style.letterSpacing = '0.3px';
    title.style.color = 'rgba(209,213,219,0.9)';

    const hr = document.createElement('div');
    hr.style.height = '1px';
    hr.style.background = 'rgba(75,85,99,0.6)';
    hr.style.margin = '4px 0 8px 0';

    const text = document.createElement('div');
    text.style.fontSize = '18px';
    text.style.lineHeight = '1.7';
    text.style.color = '#f3f4f6';
    text.style.whiteSpace = 'pre-wrap';
    text.style.wordBreak = 'break-word';
    text.textContent = bodyText || '';

    titleRow.appendChild(title);
    card.appendChild(titleRow);
    card.appendChild(hr);
    card.appendChild(text);
    translationBodyEl.appendChild(card);
  }

  function setPopupTitledCard(bodyEl, titleText, bodyText) {
    if (!bodyEl) return;
    const card = document.createElement('div');
    card.style.border = '1px solid rgba(75,85,99,0.9)';
    card.style.background = 'rgba(17,24,39,0.9)';
    card.style.borderRadius = '12px';
    card.style.padding = '12px 14px';
    card.style.boxShadow = '0 8px 22px rgba(0,0,0,0.30)';

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.justifyContent = 'space-between';
    titleRow.style.marginBottom = '8px';

    const title = document.createElement('span');
    title.textContent = titleText || '';
    title.style.fontSize = '13px';
    title.style.letterSpacing = '0.3px';
    title.style.color = 'rgba(209,213,219,0.9)';

    const hr = document.createElement('div');
    hr.style.height = '1px';
    hr.style.background = 'rgba(75,85,99,0.6)';
    hr.style.margin = '4px 0 8px 0';

    const text = document.createElement('div');
    text.style.fontSize = '18px';
    text.style.lineHeight = '1.7';
    text.style.color = '#f3f4f6';
    text.style.whiteSpace = 'pre-wrap';
    text.style.wordBreak = 'break-word';
    text.textContent = bodyText || '';

    titleRow.appendChild(title);
    card.appendChild(titleRow);
    card.appendChild(hr);
    card.appendChild(text);
    bodyEl.appendChild(card);
  }

  function setPopupQuestionView(bodyEl, questionText) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const words = document.createElement('div');
    words.style.lineHeight = '1.8';
    words.style.fontSize = '19px';
    words.style.color = '#e5e7eb';
    words.style.marginBottom = '8px';
    renderClickableWords(words, questionText);
    bodyEl.appendChild(words);
    // create a titled card below words; caller will fill translated text
    // initialize with original question for now
    setPopupTitledCard(bodyEl, 'Question', questionText || '');
    popupWordsContainerEl = words;
  }

  function renderQuestionClickableBlock(targetEl, text, beforeEl) {
    if (!targetEl) return;
    // Render a messenger-style left-aligned bubble for the question
    const row = document.createElement('div');
    row.className = `${EXT_CLS_PREFIX}-question-block`;
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-start';
    row.style.margin = '6px 0';
    const bubble = document.createElement('div');
    bubble.style.maxWidth = '85%';
    bubble.style.background = 'rgba(31,41,55,0.9)';
    bubble.style.border = '1px solid rgba(75,85,99,0.8)';
    bubble.style.color = '#e5e7eb';
    bubble.style.borderRadius = '14px';
    bubble.style.padding = '10px 12px';
    const header = document.createElement('div');
    header.textContent = 'Question';
    header.style.color = 'rgba(209,213,219,0.9)';
    header.style.fontSize = '12px';
    header.style.marginBottom = '4px';
    const words = document.createElement('div');
    words.style.lineHeight = '1.8';
    words.style.fontSize = '18px';
    words.style.color = '#e5e7eb';
    renderClickableWords(words, text || '');
    bubble.appendChild(header);
    bubble.appendChild(words);
    row.appendChild(bubble);
    
    if (beforeEl && beforeEl.parentNode === targetEl) {
      targetEl.insertBefore(row, beforeEl);
    } else {
      targetEl.appendChild(row);
    }
    return words;
  }

  function renderResponseCard(targetEl, text, beforeEl) {
    // Messenger-style right-aligned bubble for user answer
    const answerContainer = document.createElement('div');
    answerContainer.className = `${EXT_CLS_PREFIX}-answer-container`;
    answerContainer.style.margin = '6px 0';
    
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'flex-end';
    row.style.marginBottom = '4px';
    
    const bubble = document.createElement('div');
    bubble.style.maxWidth = '85%';
    bubble.style.background = '#2563eb';
    bubble.style.border = 'none';
    bubble.style.color = '#ffffff';
    bubble.style.borderRadius = '14px';
    bubble.style.padding = '10px 12px';
    
    const body = document.createElement('div');
    body.style.fontSize = '16px';
    body.style.lineHeight = '1.7';
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = text || '';
    bubble.appendChild(body);
    row.appendChild(bubble);
    answerContainer.appendChild(row);
    
    if (beforeEl && beforeEl.parentNode === targetEl) {
      targetEl.insertBefore(answerContainer, beforeEl);
    } else {
      targetEl.appendChild(answerContainer);
    }
    
    return answerContainer;
  }

  function updateInputVisibility(targetEl) {
    const inputContainer = targetEl.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
    if (!inputContainer) return;
    
    // Check if the last message is from the teacher (question block)
    const questionBlocks = targetEl.querySelectorAll(`.${EXT_CLS_PREFIX}-question-block`);
    const answerContainers = targetEl.querySelectorAll(`.${EXT_CLS_PREFIX}-answer-container`);
    
    // If there are no questions yet, show input
    if (questionBlocks.length === 0) {
      inputContainer.style.display = 'block';
      return;
    }
    
    // Find the last question and last answer
    const lastQuestion = questionBlocks[questionBlocks.length - 1];
    const lastAnswer = answerContainers[answerContainers.length - 1];
    
    if (!lastAnswer) {
      // No answers yet, show input
      inputContainer.style.display = 'block';
    } else {
      // Check if last question is after last answer
      const lastQuestionRect = lastQuestion.getBoundingClientRect();
      const lastAnswerRect = lastAnswer.getBoundingClientRect();
      
      if (lastQuestionRect.top > lastAnswerRect.top) {
        // Last message is from teacher, show input
        inputContainer.style.display = 'block';
      } else {
        // Last message is from user, hide input
        inputContainer.style.display = 'none';
      }
    }
  }

  function attachResponseControls(targetEl, detectedLang) {
    const lang = (detectedLang && detectedLang !== 'unknown') ? detectedLang : getDocumentLanguage() || 'en';
    
    // Create input container that will be positioned at the bottom
    const inputContainer = document.createElement('div');
    inputContainer.className = `${EXT_CLS_PREFIX}-input-container`;
    inputContainer.style.position = 'sticky';
    inputContainer.style.bottom = '0';
    inputContainer.style.background = 'rgba(17,24,39,0.95)';
    inputContainer.style.padding = '12px 0';
    inputContainer.style.borderTop = '1px solid rgba(75,85,99,0.3)';
    inputContainer.style.marginTop = '12px';
    
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type your answer…';
    input.style.flex = '1';
    input.style.padding = '10px 12px';
    input.style.borderRadius = '8px';
    input.style.border = '1px solid rgba(75,85,99,0.8)';
    input.style.background = 'rgba(31,41,55,0.7)';
    input.style.color = '#e5e7eb';
    input.style.fontSize = '14px';

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '8px';

    const micBtn = document.createElement('button');
    micBtn.title = 'Speak your answer';
    micBtn.textContent = '🎤';
    micBtn.style.padding = '8px 10px';
    micBtn.style.borderRadius = '8px';
    micBtn.style.border = '1px solid rgba(75,85,99,0.8)';
    micBtn.style.background = 'rgba(31,41,55,0.7)';
    micBtn.style.color = '#e5e7eb';
    micBtn.style.cursor = 'pointer';

    const sendBtn = document.createElement('button');
    sendBtn.title = 'Send';
    sendBtn.textContent = 'Send';
    sendBtn.style.padding = '8px 12px';
    sendBtn.style.borderRadius = '8px';
    sendBtn.style.border = 'none';
    sendBtn.style.background = '#2563eb';
    sendBtn.style.color = '#fff';
    sendBtn.style.cursor = 'pointer';

    right.appendChild(micBtn);
    right.appendChild(sendBtn);
    row.appendChild(input);
    row.appendChild(right);
    inputContainer.appendChild(row);
    targetEl.appendChild(inputContainer);

    let recognition = null;
    function getRecognition() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return null;
      const r = new SR();
      try { r.lang = lang || 'en'; } catch {}
      r.continuous = false;
      r.interimResults = false;
      return r;
    }

    micBtn.addEventListener('click', () => {
      if (recognition) {
        try { recognition.stop(); } catch {}
        recognition = null;
        micBtn.style.background = 'rgba(31,41,55,0.7)';
        return;
      }
      recognition = getRecognition();
      if (!recognition) {
        micBtn.title = 'Speech recognition not supported in this browser';
        return;
      }
      micBtn.style.background = 'rgba(37,99,235,0.25)';
      recognition.onresult = (e) => {
        try {
          const t = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript;
          if (t) input.value = t;
        } catch {}
      };
      recognition.onerror = () => { micBtn.style.background = 'rgba(31,41,55,0.7)'; };
      recognition.onend = () => { micBtn.style.background = 'rgba(31,41,55,0.7)'; recognition = null; };
      try { recognition.start(); } catch { micBtn.style.background = 'rgba(31,41,55,0.7)'; recognition = null; }
    });

    async function handleSend() {
      const txt = (input.value || '').trim();
      if (!txt) return;
      
      // Hide input while processing
      inputContainer.style.display = 'none';
      
      const answerContainer = renderResponseCard(targetEl, txt, inputContainer);
      
      // Show "Thinking..." state on the ask button
      setActionButtonsDisabled(true);
      const askBtn = popupEl ? popupEl.querySelector(`.${EXT_CLS_PREFIX}-btn-ask`) : null;
      if (askBtn) {
        askBtn.textContent = 'Thinking…';
      }
      
      // Evaluate the answer using Prompt API (page-side) when available
      try {
        const requestId = `weblang_eval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const contextText = (overlayWordsContainerEl && overlayWordsContainerEl.textContent) || (popupWordsContainerEl && popupWordsContainerEl.textContent) || '';
        const onEval = (e) => {
          try {
            if (!e || !e.detail || e.detail.id !== requestId) return;
            window.removeEventListener('weblang-eval-result', onEval, true);
            const result = (e.detail && e.detail.ok && e.detail.result) ? e.detail.result : (e.detail && e.detail.error ? e.detail.error : 'No evaluation.');
            
            // Add evaluation directly below the answer
            const evaluation = document.createElement('div');
            evaluation.style.fontSize = '12px';
            evaluation.style.color = 'rgba(229,231,235,0.85)';
            evaluation.style.margin = '4px 0 0 0';
            evaluation.style.textAlign = 'right';
            evaluation.style.fontStyle = 'italic';
            evaluation.textContent = result;
            answerContainer.appendChild(evaluation);
            
            // Re-enable ask button for follow-up questions
            setActionButtonsDisabled(false);
            if (askBtn) {
              askBtn.textContent = 'Ask me a question';
            }
            
            // Update input visibility based on conversation state
            updateInputVisibility(targetEl);
            input.value = '';
            if (inputContainer.style.display !== 'none') {
              input.focus();
            }
          } catch {}
        };
        window.addEventListener('weblang-eval-result', onEval, true);
        chrome.runtime && chrome.runtime.sendMessage({ type: 'WEBLANG_EVAL_REQUEST', id: requestId, question: contextText, answer: txt, context: contextText });
      } catch {
        // Re-enable ask button on error
        setActionButtonsDisabled(false);
        if (askBtn) {
          askBtn.textContent = 'Ask me a question';
        }
        // Show input again on error
        updateInputVisibility(targetEl);
        input.value = '';
      }
    }
    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });
  }

  function setPopupTranslationLoading(bodyEl, message) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.fontSize = '16px';
    wrap.style.color = '#e5e7eb';
    wrap.textContent = message || 'Translating…';
    bodyEl.appendChild(wrap);
  }

  function setPopupTranslationResult(bodyEl, resultText) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const box = document.createElement('div');
    box.style.border = '1px solid rgba(75,85,99,0.9)';
    box.style.background = 'rgba(17,24,39,0.9)';
    box.style.borderRadius = '10px';
    box.style.padding = '10px 12px';
    const text = document.createElement('div');
    text.style.fontSize = '17px';
    text.style.lineHeight = '1.7';
    text.style.color = '#f3f4f6';
    text.style.whiteSpace = 'pre-wrap';
    text.style.wordBreak = 'break-word';
    text.textContent = resultText || 'Translation not available.';
    box.appendChild(text);

    // Add save to vocab button if we have translation text and selected word
    console.log(resultText, selectedWords);
    if (resultText && resultText.trim() && selectedWords.length > 0) {
      const selectedWord = selectedWords.join(' ');
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Add to Vocab';
      saveBtn.style.width = '100%';
      saveBtn.style.padding = '8px 12px';
      saveBtn.style.background = '#10b981';
      saveBtn.style.border = 'none';
      saveBtn.style.color = '#fff';
      saveBtn.style.borderRadius = '8px';
      saveBtn.style.fontSize = '13px';
      saveBtn.style.cursor = 'pointer';
      saveBtn.style.marginTop = '12px';
      saveBtn.style.fontWeight = '500';
      
      saveBtn.addEventListener('click', async () => {
        try {
          const result = await saveWordToVocab(resultText.trim());
          if (result.success) {
            if (result.isNewWord) {
              saveBtn.textContent = 'Added!';
              saveBtn.style.background = '#059669';
            } else {
              saveBtn.textContent = 'Updated!';
              saveBtn.style.background = '#f59e0b';
            }
            setTimeout(() => {
              saveBtn.textContent = 'Add to Vocab';
              saveBtn.style.background = '#10b981';
            }, 1500);
          } else {
            saveBtn.textContent = 'Already exists';
            saveBtn.style.background = '#6b7280';
            setTimeout(() => {
              saveBtn.textContent = 'Add to Vocab';
              saveBtn.style.background = '#10b981';
            }, 1500);
          }
        } catch (error) {
          saveBtn.textContent = 'Error';
          saveBtn.style.background = '#ef4444';
          setTimeout(() => {
            saveBtn.textContent = 'Add to Vocab';
            saveBtn.style.background = '#10b981';
          }, 1500);
        }
      });
      
      box.appendChild(saveBtn);
    }

    bodyEl.appendChild(box);
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
      } catch {
        return null;
      }
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

  async function translateTo(text, targetLang, sourceLangOpt) {
    try {
      if (!('Translator' in self)) return null;
      const src = sourceLangOpt || getDocumentLanguage();
      const translator = await getTranslator(src, targetLang, () => {});
      if (!translator) return null;
      const result = await translator.translate(text);
      return typeof result === 'string' ? result : (result && (result.translation || result.translatedText || ''));
    } catch { return null; }
  }

  // Prompt API (Gemini Nano) helper executed in the PAGE context (not content script)
  async function askQuestionWithPromptAPI(selectedText, existingQuestions = []) {
    const requestId = `weblang_prompt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const onResult = (e) => {
        try {
          if (!e || !e.detail || e.detail.id !== requestId) return;
          window.removeEventListener('weblang-prompt-result', onResult, true);
          if (e.detail.ok) {
            resolve(e.detail.result || '');
          } else {
            const errMsg = e.detail.error || 'Unknown Prompt API error';
            // Graceful fallback when Prompt API is not available
            if (/Prompt API not supported|unavailable/i.test(errMsg)) {
              resolve(buildHeuristicQuestion(selectedText, existingQuestions));
              return;
            }
            reject(new Error(errMsg));
          }
        } catch (err) {
          window.removeEventListener('weblang-prompt-result', onResult, true);
          reject(err);
        }
      };
      window.addEventListener('weblang-prompt-result', onResult, true);
      try {
        chrome.runtime && chrome.runtime.sendMessage({ 
          type: 'WEBLANG_PROMPT_REQUEST', 
          id: requestId, 
          text: String(selectedText||''),
          existingQuestions: existingQuestions
        });
      } catch (err) {
        window.removeEventListener('weblang-prompt-result', onResult, true);
        // If messaging fails, fallback to heuristic
        resolve(buildHeuristicQuestion(selectedText, existingQuestions));
      }
    });
  }

  function buildHeuristicQuestion(text, existingQuestions = []) {
    const t = String(text || '').trim();
    if (!t) return 'What is the main idea of this text?';
    
    // If we have many existing questions, suggest selecting another text block
    if (existingQuestions.length >= 3) {
      return 'Great questions! You\'ve explored this text thoroughly. Try selecting another paragraph or text block to continue learning!';
    }
    
    // Pick a keyword: longest word over 6 chars, else first word
    const words = t.replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
    let keyword = words.find(w => w.length >= 8) || words.find(w => w.length >= 6) || words[0] || '';
    // Prefer a capitalized content word if available
    const cap = words.find(w => /^[A-Z][a-z]+$/.test(w));
    if (cap) keyword = cap;
    
    // Choose a question template based on text length and existing questions
    const questionTemplates = [
      'What is the main argument of this paragraph?',
      'What does this text suggest about the author\'s perspective?',
      'How does this paragraph connect to the overall topic?',
      'What evidence does the author provide?',
      'What is the tone of this passage?',
      'What can you infer from this text?'
    ];
    
    if (existingQuestions.length >= 2) {
      return questionTemplates[existingQuestions.length % questionTemplates.length];
    }
    
    if (t.length > 240) return 'What is the main argument of this paragraph?';
    if (keyword && keyword.length >= 6) return `What does "${keyword}" mean in this context?`;
    return 'What is the key point of this sentence?';
  }

  function buildControlsBar(context, selectedText) {
    const bar = document.createElement('div');
    bar.classList.add(`${EXT_CLS_PREFIX}-controls`);
    bar.style.display = 'grid';
    bar.style.gridTemplateColumns = context === 'sidebar' ? 'auto 1fr auto' : 'auto 1fr auto';
    bar.style.alignItems = 'center';
    bar.style.gap = '10px';
    bar.style.marginTop = '10px';

    const langBtn = document.createElement('button');
    langBntStyles(langBtn);
    langBtn.textContent = 'Detecting…';
    
    // Store the promise so we can wait for it later
    const languageDetectionPromise = detectLanguageCode(selectedText, (msg)=>{ 
      try { langBtn.textContent = msg; } catch {} 
    }).then((code)=>{
      try { 
        const detectedLang = code || 'unknown';
        console.log('Language detected for text:', selectedText, '->', detectedLang);
        langBtn.textContent = detectedLang;
        currentDetectedLanguage = detectedLang; // Store for reuse
        return detectedLang;
      } catch (error) {
        console.error('Error in language detection:', error);
        return 'unknown';
      }
    });
    
    // Store the promise globally so save functions can wait for it
    window.currentLanguageDetectionPromise = languageDetectionPromise;

    const centerWrap = document.createElement('div');
    centerWrap.style.display = 'flex';
    centerWrap.style.justifyContent = 'center';
    centerWrap.style.gap = '8px';

    const btnAsk = document.createElement('button');
    btnAsk.classList.add(`${EXT_CLS_PREFIX}-btn-ask`);
    primaryBtnStyles(btnAsk);
    btnAsk.textContent = 'Ask me a question';
    btnAsk.addEventListener('click', async () => {
      try {
        setActionButtonsDisabled(true); btnAsk.textContent = 'Asking…';
        if (context === 'popup') {
          if (popupBodyRef) {
            // Check if this is the first question or a follow-up
            const hasExistingContent = popupBodyRef.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
            if (!hasExistingContent) {
              setPopupTranslationLoading(popupBodyRef, 'Generating question…');
            }
            
            // Collect existing questions for context
            const existingQuestions = [];
            const questionBlocks = popupBodyRef.querySelectorAll(`.${EXT_CLS_PREFIX}-question-block`);
            questionBlocks.forEach(block => {
              const questionText = block.textContent || '';
              if (questionText.trim()) {
                existingQuestions.push(questionText.trim());
              }
            });
            
            const q = await askQuestionWithPromptAPI(selectedText, existingQuestions);
            if (popupBodyRef) {
              const srcLang = await detectLanguageCode(selectedText);
              const target = (srcLang && srcLang !== 'unknown') ? srcLang : getDocumentLanguage();
              const translated = await translateTo(q, target, 'en');
              const finalQ = translated || q || '';
              // Insert question before the input container if it exists
              const inputContainer = popupBodyRef.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
              const wordsEl = renderQuestionClickableBlock(popupBodyRef, finalQ, inputContainer);
              popupWordsContainerEl = wordsEl;
              // Only attach response controls if this is the first question
              if (!hasExistingContent) {
                attachResponseControls(popupBodyRef, srcLang);
              }
              // Update input visibility after adding question
              updateInputVisibility(popupBodyRef);
            }
          }
        } else {
          // If used inside overlay, render into translation area
          const hasExistingContent = translationBodyEl.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
          if (!hasExistingContent) {
            setOverlayTranslationLoading('Generating question…');
          }
          
          // Collect existing questions for context
          const existingQuestions = [];
          const questionBlocks = translationBodyEl.querySelectorAll(`.${EXT_CLS_PREFIX}-question-block`);
          questionBlocks.forEach(block => {
            const questionText = block.textContent || '';
            if (questionText.trim()) {
              existingQuestions.push(questionText.trim());
            }
          });
          
          const q = await askQuestionWithPromptAPI(selectedText, existingQuestions);
          const srcLang = await detectLanguageCode(selectedText);
          const target = (srcLang && srcLang !== 'unknown') ? srcLang : getDocumentLanguage();
          const translated = await translateTo(q, target, 'en');
          const finalQ = translated || q || '';
          // Append new question instead of replacing
          if (hasExistingContent) {
            // Insert question before the input container
            const inputContainer = translationBodyEl.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
            renderQuestionClickableBlock(translationBodyEl, finalQ, inputContainer);
          } else {
            translationBodyEl.innerHTML = '';
            renderQuestionClickableBlock(translationBodyEl, finalQ);
            attachResponseControls(translationBodyEl, srcLang);
          }
          // Update input visibility after adding question
          updateInputVisibility(translationBodyEl);
        }
      } catch (e) {
        const msg = (e && e.message) ? e.message : 'Unable to generate a question.';
        if (context === 'popup') {
          if (popupBodyRef) setPopupTranslationResult(popupBodyRef, msg);
        } else {
          setOverlayTranslationResult(msg);
        }
      } finally {
        setActionButtonsDisabled(false); btnAsk.textContent = 'Ask me a question';
      }
    });

    centerWrap.appendChild(btnAsk);

    // Sidebar control removed

    // Order swap in sidebar: rightBtn on left? Spec says swap positions of language and open button
    bar.appendChild(langBtn);
    bar.appendChild(centerWrap);
    return bar;
  }

  function setActionButtonsDisabled(disabled) {
    try {
      if (!popupEl) return;
      const ask = popupEl.querySelector(`.${EXT_CLS_PREFIX}-btn-ask`);
      if (ask) {
        ask.disabled = !!disabled;
        if (disabled) {
          ask.style.position = 'relative';
          ask.style.overflow = 'hidden';
          ask.style.background = 'linear-gradient(45deg, #2563eb, #3b82f6, #60a5fa, #93c5fd)';
          ask.style.backgroundSize = '400% 400%';
          ask.style.animation = 'weblang-gradient-spin 1.5s ease-in-out infinite';
          ask.style.border = '2px solid transparent';
          ask.style.backgroundClip = 'padding-box';
          // Add the spinning border effect
          ask.style.boxShadow = '0 0 0 2px #2563eb, 0 0 0 4px rgba(37, 99, 235, 0.3)';
        } else {
          ask.style.background = '#2563eb';
          ask.style.backgroundSize = '';
          ask.style.animation = '';
          ask.style.border = 'none';
          ask.style.backgroundClip = '';
          ask.style.boxShadow = '';
        }
      }
    } catch {}
  }

  function langBntStyles(btn){
    btn.style.padding = '6px 10px';
    btn.style.background = 'rgba(31,41,55,0.6)';
    btn.style.border = '1px solid rgba(75,85,99,0.7)';
    btn.style.color = '#e5e7eb';
    btn.style.fontSize = '12px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'default';
  }

  function primaryBtnStyles(btn){
    btn.style.padding = '8px 12px';
    btn.style.background = '#2563eb';
    btn.style.border = 'none';
    btn.style.color = '#fff';
    btn.style.fontSize = '13px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
  }

  function secondaryBtnStyles(btn){
    btn.style.padding = '8px 12px';
    btn.style.background = 'rgba(31,41,55,0.7)';
    btn.style.border = '1px solid rgba(75,85,99,0.8)';
    btn.style.color = '#e5e7eb';
    btn.style.fontSize = '13px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
  }

  function iconBtnStyles(btn){
    btn.style.padding = '8px 12px';
    btn.style.background = 'rgba(31,41,55,0.7)';
    btn.style.border = '1px solid rgba(75,85,99,0.8)';
    btn.style.color = '#e5e7eb';
    btn.style.fontSize = '13px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
  }

  // Sidebar functionality removed

  function createPopup(position, text, translation, isTranslating) {
    clearPopup();
    const container = ensureContainer();
    ensureBackdrop();
    popupEl = document.createElement('div');
    popupEl.className = `${EXT_CLS_PREFIX}-popup`;
    popupEl.style.position = 'fixed';
    popupEl.style.left = `${position.x}px`;
    popupEl.style.top = `${position.y}px`;
    popupEl.style.transform = position.transform;
    popupEl.style.width = '380px';
    popupEl.style.pointerEvents = 'auto';
    popupEl.style.background = 'rgba(17,24,39,0.96)';
    popupEl.style.border = '1px solid rgba(75,85,99,0.9)';
    popupEl.style.color = '#e5e7eb';
    popupEl.style.borderRadius = '12px';
    popupEl.style.boxShadow = '0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset';
    popupEl.style.padding = '14px';
    popupEl.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif';
    popupEl.style.backdropFilter = 'none';
    popupEl.style.webkitBackdropFilter = 'none';

    const body = document.createElement('div');
    body.style.fontSize = '18px';
    body.style.color = '#e5e7eb';
    body.style.marginBottom = '8px';
    body.style.wordBreak = 'break-word';
    if (isTranslating) {
      setPopupTranslationLoading(body, 'Translating…');
    } else {
      setPopupTranslationResult(body, translation || text || '');
    }
    popupBodyRef = body;

    const controls = buildControlsBar('popup', text);

    popupEl.appendChild(body);
    popupEl.appendChild(controls);

    container.appendChild(popupEl);

    return { bodyEl: body };
  }

  function createOverlayForText(rect, text, sourceParagraphEl) {
    clearPopup();
    const container = ensureContainer();
    ensureBackdrop();

    popupEl = document.createElement('div');
    popupEl.className = `${EXT_CLS_PREFIX}-overlay`;
    popupEl.style.position = 'fixed';
    popupEl.style.left = `${rect.left}px`;
    popupEl.style.top = `${rect.top}px`;
    popupEl.style.width = `${rect.width}px`;
    popupEl.style.overflow = 'visible';
    popupEl.style.pointerEvents = 'auto';
    popupEl.style.background = 'rgba(17,24,39,0.92)';
    popupEl.style.backdropFilter = 'blur(2px)';
    popupEl.style.border = '1px solid rgba(55,65,81,0.9)';
    popupEl.style.color = '#e5e7eb';
    popupEl.style.borderRadius = '12px';
    popupEl.style.boxShadow = '0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset';
    popupEl.style.padding = '0';
    popupEl.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif';
    popupEl.style.zIndex = '2147483647';

    // Card-level drag: mousedown on non-interactive space starts drag
    attachDragListeners();
    popupEl.addEventListener('mousedown', (e) => {
      if (isInteractiveTarget(e.target)) return;
      try {
        isDraggingPopup = true;
        const r = popupEl.getBoundingClientRect();
        popupEl.style.transform = 'none';
        dragOffsetX = e.clientX - r.left;
        dragOffsetY = e.clientY - r.top;
        e.preventDefault();
        e.stopPropagation();
      } catch {}
    });

    // Content wrapper
    popupContentEl = document.createElement('div');
    popupContentEl.style.padding = '14px';

    const wordsContainer = document.createElement('div');
    wordsContainer.style.lineHeight = '1.8';
    wordsContainer.style.fontSize = '19px';
    wordsContainer.style.color = '#e5e7eb';
    wordsContainer.style.marginBottom = '8px';

    renderClickableWords(wordsContainer, text);
    overlayWordsContainerEl = wordsContainer;

    translationBodyEl = document.createElement('div');
    translationBodyEl.style.fontSize = '18px';
    translationBodyEl.style.color = '#e5e7eb';
    translationBodyEl.style.marginTop = '8px';

    popupContentEl.appendChild(wordsContainer);
    popupContentEl.appendChild(translationBodyEl);
    const controlsBar = buildControlsBar('overlay', text);
    popupContentEl.appendChild(controlsBar);

    popupEl.appendChild(popupContentEl);
    container.appendChild(popupEl);

    // Manage paragraph styles while overlay is open
    if (sourceParagraphEl) {
      activeParagraphEl = sourceParagraphEl;
      // Remove hover overlay and clickable styling while active
      detachHoverOverlay();
      activeParagraphEl.classList.remove(`${EXT_CLS_PREFIX}-clickable`, `${EXT_CLS_PREFIX}-selected`);
    } else {
      activeParagraphEl = null;
    }
  }

  function resetSelectionState() {
    selectedWords = [];
    selectionStartIndex = null;
    isDragging = false;
    wordOrder = [];
  }

  function addClickableStyles() {
    const styleId = `${EXT_CLS_PREFIX}-clickable-styles`;
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
.${EXT_CLS_PREFIX}-clickable { cursor: pointer; position: relative; transition: background-color 0.15s ease, box-shadow 0.15s ease; border-radius: 4px; }
.${EXT_CLS_PREFIX}-clickable:hover { background-color: rgba(59,130,246,0.08); box-shadow: inset 3px 0 0 rgba(59,130,246,0.5); }
.${EXT_CLS_PREFIX}-selected { background-color: rgba(59,130,246,0.12) !important; box-shadow: inset 3px 0 0 rgba(59,130,246,0.7); }
`;
    document.head.appendChild(style);
  }

  function attachHoverOverlay(paragraphEl) {
    if (popupEl) return; // Don't show hover decoration when overlay is open
    detachHoverOverlay();
    try {
      hoverOverlayEl = document.createElement('div');
      hoverOverlayEl.className = `${EXT_CLS_PREFIX}-hover-overlay`;
      hoverOverlayEl.style.position = 'absolute';
      hoverOverlayEl.style.inset = '0';
      hoverOverlayEl.style.pointerEvents = 'none';
      hoverOverlayEl.style.background = 'linear-gradient(to bottom, rgba(59,130,246,0.10), rgba(59,130,246,0.14))';
      hoverOverlayEl.style.borderRadius = getComputedStyle(paragraphEl).borderRadius || '4px';
      hoverOverlayEl.style.boxShadow = 'inset 0 0 0 1px rgba(75,85,99,0.65), 0 8px 20px rgba(0,0,0,0.18)';
      hoverOverlayEl.style.transition = 'opacity 120ms ease';
      hoverOverlayEl.style.opacity = '1';
      paragraphEl.appendChild(hoverOverlayEl);
    } catch {}
  }

  function detachHoverOverlay() {
    if (hoverOverlayEl && hoverOverlayEl.parentNode) {
      try { hoverOverlayEl.parentNode.removeChild(hoverOverlayEl); } catch {}
    }
    hoverOverlayEl = null;
  }

  async function scrollElementToTop(element) {
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    } catch {
      try { element.scrollIntoView(true); } catch {}
    }
    const maxWaitMs = 1200;
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let lastTop = null;
    // Wait until the element is near the top or scrolling stabilizes
    while (((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - start) < maxWaitMs) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const rect = element.getBoundingClientRect();
      if (rect.top <= 8) break; // close enough to top
      if (lastTop !== null && Math.abs(rect.top - lastTop) < 0.5) break; // stopped moving
      lastTop = rect.top;
    }
  }

  async function openOverlayForElement(element, sourceParagraphEl, options = {}) {
    await scrollElementToTop(element);
    const rect = element.getBoundingClientRect();
    const text = element.innerText || element.textContent || '';
    if (options.forcePopup) {
      createOverlayForText(rect, text, sourceParagraphEl || null);
      return;
    }
    // If user prefers native sidebar, route there instead of inline overlay
    try {
      const stored = await new Promise((resolve) => {
        if (!chrome.storage || !chrome.storage.local) return resolve({ weblangPreferSidebar: preferSidebar });
        chrome.storage.local.get(['weblangPreferSidebar'], (res) => resolve(res || {}));
      });
      if (stored && stored.weblangPreferSidebar) {
        preferSidebar = true;
        try { chrome.runtime && chrome.runtime.sendMessage({ type: 'WEBLANG_OPEN_SIDEBAR' }); } catch {}
        try {
          await openInNativeSidebar(text);
          return;
        } catch (e) {
          // Fallback to popup if native sidebar fails
          try { chrome.storage && chrome.storage.local && chrome.storage.local.set({ weblangPreferSidebar: false }); } catch {}
        }
      }
    } catch {}
    createOverlayForText(rect, text, sourceParagraphEl || null);
  }

  function hasSubstantialText(element) {
    const text = element.textContent || element.innerText || '';
    const cleanText = text.trim();
    if (cleanText.length < 50) return false;
    const sentences = cleanText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    return sentences.length >= 2;
  }

  function isClickInsideInteractiveElement(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"]');
  }

  async function handleParagraphClick(event) {
    if (isClickInsideInteractiveElement(event.target)) return;
    const selection = window.getSelection && window.getSelection();
    if (selection && selection.type === 'Range' && selection.toString().trim().length > 0) return;
    const paragraph = event.currentTarget;
    // Remove hover visuals and selection highlight when opening overlay
    detachHoverOverlay();
    paragraph.classList.remove(`${EXT_CLS_PREFIX}-selected`);
    await openOverlayForElement(paragraph, paragraph);
  }

  function makeClickableParagraphs() {
    const paragraphs = document.querySelectorAll('p');
    paragraphs.forEach((p) => {
      if (clickableNodes.has(p)) return;
      if (!hasSubstantialText(p)) return;
      p.classList.add(`${EXT_CLS_PREFIX}-clickable`);
      p.addEventListener('click', handleParagraphClick, true);
      p.addEventListener('mouseenter', () => attachHoverOverlay(p), true);
      p.addEventListener('mouseleave', () => detachHoverOverlay(), true);
      clickableNodes.add(p);
      if (!p.title) p.title = 'Click to open Weblang overlay';
    });
  }

  function calculatePosition(rect) {
    const popupWidth = 320;
    const popupHeight = 200;
    const margin = 15;
    const viewportWidth = window.innerWidth;

    const top = rect.top;
    const bottom = rect.bottom;
    const left = rect.left;
    const width = rect.width;

    let y, transformY;
    if (rect.top > popupHeight + margin) {
      y = top - margin;
      transformY = '-100%';
    } else {
      y = bottom + margin;
      transformY = '0%';
    }

    let x = left + width / 2;
    if (x - popupWidth / 2 < margin) {
      x = margin + popupWidth / 2;
    } else if (x + popupWidth / 2 > viewportWidth - margin) {
      x = viewportWidth - margin - popupWidth / 2;
    }

    return { x, y, transform: `translate(-50%, ${transformY})` };
  }

  function unmarkSelected() {
    const scope = popupEl || document;
    scope.querySelectorAll(`.${EXT_CLS_PREFIX}-word-selected`).forEach((el) => {
      el.classList.remove(`${EXT_CLS_PREFIX}-word-selected`);
      el.style.background = '';
      el.style.color = '';
      el.style.borderBottom = '';
    });
  }

  function markSelected(spans) {
    unmarkSelected();
    spans.forEach((span) => {
      span.classList.add(`${EXT_CLS_PREFIX}-word-selected`);
      span.style.background = '#2563eb';
      span.style.color = '#fff';
      span.style.borderBottom = 'none';
      span.style.borderRadius = '4px';
    });
  }

  function renderClickableWords(container, text) {
    wordOrder = [];
    selectionStartIndex = null;
    isDragging = false;

    const parts = String(text || '').split(/(\s+)/);
    parts.forEach((part) => {
      if (part.trim() === '') {
        container.appendChild(document.createTextNode(part));
      } else {
        const cleanWord = part.replace(/[^\w\s'-]/g, '').trim();
        const span = document.createElement('span');
        span.className = `${EXT_CLS_PREFIX}-word`;
        span.textContent = part;
        span.style.cursor = 'pointer';
        span.style.transition = 'color 150ms ease-in-out, background 150ms ease-in-out';
        span.style.borderBottom = '1px dashed rgba(156,163,175,0.6)';
        span.style.display = 'inline-block';
        span.style.padding = '0 2px';

        const currentIndex = wordOrder.length;
        if (cleanWord) {
          wordOrder.push({ word: cleanWord, span });
        }

        span.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!cleanWord) return;
          isDragging = true;
          selectedWords = [cleanWord];
          selectionStartIndex = currentIndex;
          markSelected([span]);
        });

        span.addEventListener('mouseenter', (e) => {
          if (!isDragging || selectionStartIndex === null) return;
          e.preventDefault();
          e.stopPropagation();
          const start = selectionStartIndex;
          const end = currentIndex;
          const minIndex = Math.min(start, end);
          const maxIndex = Math.max(start, end);
          const sequential = wordOrder.slice(minIndex, maxIndex + 1);
          selectedWords = sequential.map((w) => w.word);
          markSelected(sequential.map((w) => w.span));
        });

        container.appendChild(span);
      }
    });
  }

  async function translate(text, targetLang = 'en', onProgressCb) {
    try {
      if (!('Translator' in self)) return null;
      let sourceLang = getDocumentLanguage();
      try {
        if (chrome.storage && chrome.storage.local) {
          const conf = await new Promise((resolve)=> chrome.storage.local.get(['weblangUserLang','weblangLearnLang'], (r)=> resolve(r||{})));
          if (conf && conf.weblangUserLang) sourceLang = conf.weblangUserLang;
          if (conf && conf.weblangLearnLang) targetLang = conf.weblangLearnLang;
        }
      } catch {}
      const translator = await getTranslator(sourceLang, targetLang, (msg) => {
        try { if (typeof onProgressCb === 'function') onProgressCb(msg); } catch {}
      });
      if (!translator) return null;
      const result = await translator.translate(text);
      return typeof result === 'string' ? result : (result && (result.translation || result.translatedText || ''));
    } catch (e) {
      return null;
    }
  }

  function handleGlobalMouseUp() {
    if (isDragging) {
      isDragging = false;
      if (selectedWords.length > 0) {
        const scope = popupEl || document;
        const spans = scope.querySelectorAll(`.${EXT_CLS_PREFIX}-word-selected`);
        if (spans.length > 0) {
          const selectedText = selectedWords.join(' ');
          // Show translation in a separate floating tip below the selected sequence (do not replace overlay/popup)
          const firstRect = spans[0].getBoundingClientRect();
          const lastRect = spans[spans.length - 1].getBoundingClientRect();
          const combinedRect = {
            top: firstRect.top,
            bottom: lastRect.bottom,
            left: firstRect.left,
            right: lastRect.right,
            width: lastRect.right - firstRect.left,
            height: lastRect.bottom - firstRect.top
          };
          const pos = calculatePosition(combinedRect);
          const { bodyEl } = createTipPopover(pos, selectedText, true);
          translate(selectedText, 'en', (msg)=>{ try { bodyEl.textContent = msg; } catch {} }).then((t) => {
            if (!tipEl) return;
            setPopupTranslationResult(bodyEl, t || 'Translation not available.');
          });
        }
      }
    }
  }

  function handleClickOutside(e) {
    const target = e.target;
    const insidePopup = popupEl && popupEl.contains(target);
    const insideTip = tipEl && tipEl.contains(target);
    // Close tip when clicking anywhere outside of it (including inside the popup)
    if (!insideTip) {
      clearTip();
      unmarkSelected();
      selectedWords = [];
    }

    // Close popup only when clicking outside both
    if (!insidePopup && !insideTip) {
      clearPopup();
      resetSelectionState();
      if (activeParagraphEl) {
        try { activeParagraphEl.classList.add(`${EXT_CLS_PREFIX}-clickable`); } catch {}
        activeParagraphEl = null;
      }
    }
  }

  function findTextBlockElement(startEl) {
    let el = startEl;
    const disallowTags = /^(A|BUTTON|INPUT|TEXTAREA|SELECT|SCRIPT|STYLE|NOSCRIPT)$/i;
    while (el && el !== document.body) {
      if (el.nodeType === Node.ELEMENT_NODE) {
        const tag = el.tagName || '';
        if (disallowTags.test(tag)) return null;
        const text = (el.innerText || el.textContent || '').trim();
        if (text && text.length >= 20) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  async function handleDocumentMouseDown(e) {
    if (!e[ACTIVATION_MODIFIER]) return; // Only when Alt/Option is held
    if (popupEl && popupEl.contains(e.target)) return; // clicks inside overlay are fine
    const el = findTextBlockElement(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    await openOverlayForElement(el, null);
  }

  // Initialize
  addClickableStyles();
  makeClickableParagraphs();
  const observer = new MutationObserver(() => {
    // Debounced update for new paragraphs
    makeClickableParagraphs();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mouseup', handleGlobalMouseUp, true);
  document.addEventListener('mousedown', handleClickOutside, true);
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
})();


