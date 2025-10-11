// Open side panel and relay preferences

chrome.runtime.onInstalled.addListener(async (details) => {
  // Check if this is a first install or update
  if (details.reason === 'install') {
    // Check if setup has already been completed
    const result = await chrome.storage.local.get(['weblangSetupCompleted']);
    
    if (!result.weblangSetupCompleted) {
      // Open setup page in a new tab
      try {
        await chrome.tabs.create({
          url: chrome.runtime.getURL('setup.html'),
          active: true
        });
      } catch (error) {
        console.error('Failed to open setup page:', error);
      }
    }
  }
});

// Handle extension icon click to open sidebar
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    console.error(`Failed to open side panel on action click: ${error}`);
  }
});

import { saveWordsToSidebar, getDomainFromUrl } from './utils.js';

const translatorCache = new Map(); // key: `${source}-${target}` -> Promise<Translator>
let languageDetectorPromise = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender) return;

  if (message.type === 'OPEN_SIDEBAR_REQUEST') {
    // This is triggered by a user click in the content script
    (async () => {
      if (sender.tab && sender.tab.id) {
        try {
          await chrome.sidePanel.open({ tabId: sender.tab.id });
        } catch (e) {
          console.error(`Failed to open side panel for tab ${sender.tab.id}:`, e);
        }
      }
    })();
    return;
  }

  if (message.type === 'WEBLANG_PROMPT_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, text, mode, history, existingQuestions, params } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['prompts.js', 'page-prompt.js']
        });
      } catch (e) {
        
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, payload, m, h, eq, p) => {
            window.dispatchEvent(new CustomEvent('weblang-prompt-request', { detail: { id: rid, text: payload, mode: m, history: h, existingQuestions: eq, params: p } }));
          },
          args: [id, text, mode, history, existingQuestions, params]
        });
      } catch (e) {
        
      }
    })();
  }
  if (message.type === 'WEBLANG_EVAL_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, question, answer, context, history } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['prompts.js', 'page-prompt.js']
        });
      } catch (e) {}
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, q, a, ctx, h) => {
            window.dispatchEvent(new CustomEvent('weblang-eval-request', { detail: { id: rid, question: q, answer: a, context: ctx, history: h } }));
          },
          args: [id, question, answer, context, history]
        });
      } catch (e) {}
    })();
  }
  
  if (message.type === 'WEBLANG_AUDIO_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, audioData, language } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['prompts.js', 'page-prompt.js']
        });
      } catch (e) {
        // ignore if already injected
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, audio, lang) => {
            window.dispatchEvent(new CustomEvent('weblang-audio-request', { detail: { id: rid, audioData: audio, language: lang } }));
          },
          args: [id, audioData, language || 'en']
        });
      } catch (e) {
        // best-effort
      }
    })();
  }
  
  if (message.type === 'WEBLANG_TEACHER_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, audioBlob, language } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['prompts.js', 'page-prompt.js']
        });
      } catch (e) {
        // ignore if already injected
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, audio, lang) => {
            window.dispatchEvent(new CustomEvent('weblang-teacher-request', { detail: { id: rid, audioBlob: audio, language: lang } }));
          },
          args: [id, audioBlob, language || 'en']
        });
      } catch (e) {
        // best-effort
      }
    })();
  }
  
  if (message.type === 'WEBLANG_IMAGE_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, imageData, mimeType, language } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['prompts.js', 'page-prompt.js']
        });
      } catch (e) {
        // ignore if already injected
      }
      
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, base64, mime, lang) => {
            window.dispatchEvent(new CustomEvent('weblang-image-request', { detail: { id: rid, imageData: base64, mimeType: mime, language: lang } }));
          },
          args: [id, imageData, mimeType, language || 'en']
        });
      } catch (e) {
        
      }
    })();
  }
  
  if (message.type === 'WEBLANG_IMAGE_FETCH') {
    const { id, imageUrl } = message;
    (async () => {
      try {
        // Fetch image data in service worker (bypasses CORS)
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const blob = await response.blob();
        
        // Check blob size to prevent memory issues
        if (blob.size > 10 * 1024 * 1024) { // 10MB limit
          throw new Error('Image too large (max 10MB)');
        }
        
        // Convert blob to ArrayBuffer for transmission
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Convert to base64 in chunks to avoid stack overflow
        let binaryString = '';
        const chunkSize = 8192; // Process in 8KB chunks
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binaryString += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binaryString);
        
        // Send base64 data back to content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'WEBLANG_IMAGE_FETCH_RESULT',
              id: id,
              ok: true,
              result: base64,
              mimeType: blob.type
            }).catch(() => {
              // Tab might be closed or not have content script
            });
          }
        });
      } catch (error) {
        // Send error back to content script
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'WEBLANG_IMAGE_FETCH_RESULT',
              id: id,
              ok: false,
              error: error.message
            }).catch(() => {
              // Tab might be closed or not have content script
            });
          }
        });
      }
    })();
  }
  
  if (message.type === 'OPEN_OPTIONS') {
    try {
      chrome.runtime.openOptionsPage();
    } catch (error) {
      console.error('Failed to open options page:', error);
    }
  }
  
  if (message.type === 'LANGUAGE_SETTINGS_UPDATED') {
    // Notify all content scripts that language settings have changed
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: 'RELOAD_LANGUAGE_SETTINGS' }).catch(() => {
            // Ignore errors for tabs that don't have the content script
          });
        }
      });
    });
  }

  if (message.type === 'SAVE_WORD_TO_VOCAB') {
    const { selectedWord, translationText, url, title, detectedLanguage } = message;
    saveWordToVocab(selectedWord, translationText, url, title, detectedLanguage)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates that the response is sent asynchronously
  }

  if (message.type === 'DETECT_LANGUAGE') {
    detectLanguageCode(message.text, sender.tab.id, message.requestId)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'TRANSLATE_TEXT') {
    const { text, targetLang, sourceLang } = message;
    translate(text, targetLang, sourceLang, sender.tab.id, message.requestId)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function getTranslator(sourceLanguage, targetLanguage, tabId, requestId) {
  if (!('Translator' in self)) return null;
  const key = `${sourceLanguage}-${targetLanguage}`;
  if (translatorCache.has(key)) return translatorCache.get(key);

  const promise = (async () => {
    try {
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
          if (!tabId || !requestId || !monitor || typeof monitor.addEventListener !== 'function') return;
          monitor.addEventListener('downloadprogress', (e) => {
            try {
              const pct = Math.round((e.loaded || 0) * 100);
              chrome.tabs.sendMessage(tabId, {
                type: 'TRANSLATION_PROGRESS',
                requestId,
                message: `Downloading translation model… ${pct}%`
              });
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

async function getLanguageDetector(tabId, requestId) {
  if (!('LanguageDetector' in self)) return null;
  if (languageDetectorPromise) return languageDetectorPromise;
  languageDetectorPromise = (async () => {
    try {
      if (typeof self.LanguageDetector.availability === 'function') {
        try { await self.LanguageDetector.availability(); } catch {}
      }
      const det = await self.LanguageDetector.create({
        monitor(m) {
          if (!tabId || !requestId || !m || typeof m.addEventListener !== 'function') return;
          m.addEventListener('downloadprogress', (e) => {
            try {
              chrome.tabs.sendMessage(tabId, {
                type: 'TRANSLATION_PROGRESS',
                requestId,
                message: `Preparing language model… ${Math.round((e.loaded||0)*100)}%`
              });
            } catch {}
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

async function detectLanguageCode(text, tabId, requestId) {
  try {
    const det = await getLanguageDetector(tabId, requestId);
    if (!det) return 'unknown';
    const results = await det.detect(String(text||''));
    if (Array.isArray(results) && results.length > 0) {
      const top = results[0];
      if (top && top.detectedLanguage) return top.detectedLanguage;
    }
    return 'unknown';
  } catch { return 'unknown'; }
}

async function translate(text, targetLang = 'en', sourceLang, tabId, requestId) {
  try {
    if (!('Translator' in self)) return null;

    let finalSourceLang = sourceLang;
    let finalTargetLang = targetLang;

    // Get user's saved language preferences
    try {
      if (chrome.storage && chrome.storage.local) {
        const conf = await new Promise((resolve) => chrome.storage.local.get(['weblangUserLang', 'weblangLearnLang'], (r) => resolve(r || {})));
        // Only fall back to preferences if caller did not supply values
        if (!finalSourceLang && conf && conf.weblangLearnLang) finalSourceLang = conf.weblangLearnLang;
        if (!finalTargetLang && conf && conf.weblangUserLang) finalTargetLang = conf.weblangUserLang;
      }
    } catch {}

    if (!finalSourceLang) {
      finalSourceLang = await detectLanguageCode(text, tabId, `source-detect-${requestId}`);
    }
    
    const translator = await getTranslator(finalSourceLang, finalTargetLang, tabId, requestId);
    if (!translator) return null;
    const result = await translator.translate(text);
    return typeof result === 'string' ? result : (result && (result.translation || result.translatedText || ''));
  } catch (e) {
    return null;
  }
}

async function saveWordToVocab(selectedWord, translationText, url, title, detectedLanguage) {
  try {
    if (!chrome.storage || !chrome.storage.local) {
      throw new Error('Storage not available');
    }

    if (!selectedWord || !translationText) {
      throw new Error('No word or translation to save');
    }

    const urlKey = `weblang_vocab_${btoa(url).replace(/[^a-zA-Z0-9]/g, '')}`;

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

    const existingEntry = existingVocab.find(entry =>
      entry.word.toLowerCase() === selectedWord.toLowerCase()
    );

    if (existingEntry) {
      existingEntry.translation = translationText;
      existingEntry.lastSaved = Date.now();
    } else {
      existingVocab.push({
        word: selectedWord,
        translation: translationText,
        url: url,
        savedAt: Date.now(),
        lastSaved: Date.now()
      });
    }

    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ [urlKey]: existingVocab }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    await saveWordsToSidebar([selectedWord], url, title, translationText, detectedLanguage);

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

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    const { ignoreList = [] } = await chrome.storage.local.get('ignoreList');
    const domain = getDomainFromUrl(tab.url);
    if (domain && ignoreList.includes(domain)) {
      return;
    }

    const data = await chrome.storage.local.get('weblangLearnLang');
    const learningLang = data.weblangLearnLang;

    if (learningLang) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: () => document.documentElement.lang
      }, (results) => {
        if (results && results[0] && results[0].result === learningLang) {
          chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['styles.css']
          });
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          });
        }
      });
    }
  }
});


