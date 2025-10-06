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
    console.log('Extension icon clicked, opening sidebar for tab:', tab.id);
    await chrome.sidePanel.open({ tabId: tab.id });
    console.log('Sidebar opened successfully');
  } catch (error) {
    console.error('Failed to open sidebar:', error);
    // Fallback: try to open without tabId
    try {
      await chrome.sidePanel.open();
      console.log('Sidebar opened without tabId');
    } catch (fallbackError) {
      console.error('Fallback sidebar open also failed:', fallbackError);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender) return;
  
  if (message.type === 'OPEN_SIDEBAR') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return;
    }
    
    // Open the sidebar for the current tab
    chrome.sidePanel.open({ tabId: tabId })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Failed to open sidebar:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep the message channel open for async response
  }
  
  if (message.type === 'WEBLANG_PROMPT_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, text, mode } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['page-prompt.js']
        });
      } catch (e) {
        // ignore if already injected
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, payload, m) => {
            window.dispatchEvent(new CustomEvent('weblang-prompt-request', { detail: { id: rid, text: payload, mode: m || 'question' } }));
          },
          args: [id, text, mode || 'question']
        });
      } catch (e) {
        // best-effort
      }
    })();
  }
  if (message.type === 'WEBLANG_EVAL_REQUEST') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) return;
    const { id, question, answer, context } = message;
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['page-prompt.js']
        });
      } catch (e) {}
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, q, a, ctx) => {
            window.dispatchEvent(new CustomEvent('weblang-eval-request', { detail: { id: rid, question: q, answer: a, context: ctx } }));
          },
          args: [id, question, answer, context]
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
          files: ['page-prompt.js']
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
          files: ['page-prompt.js']
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
    console.log('Service worker received image request:', id, typeof imageData, 'mimeType:', mimeType);
    (async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['page-prompt.js']
        });
      } catch (e) {
        // ignore if already injected
      }
      
      try {
        console.log('Passing base64 data to page-prompt, length:', imageData ? imageData.length : 'null');
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rid, base64, mime, lang) => {
            window.dispatchEvent(new CustomEvent('weblang-image-request', { detail: { id: rid, imageData: base64, mimeType: mime, language: lang } }));
          },
          args: [id, imageData, mimeType, language || 'en']
        });
      } catch (e) {
        console.error('Error passing data to page-prompt:', e);
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
});


