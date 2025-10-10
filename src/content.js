// Lightweight interactive word selection and popup translation using on-device Translator API
// No backend calls; runs entirely in content context.

(() => {
  const EXT_CLS_PREFIX = 'weblang-ext';

  let isDragging = false;
  let selectionStartIndex = null;
  let wordOrder = [];
  let selectedWords = [];
  let popupEl = null;
  let textContainer = null;
  let translationBodyEl = null;
  const clickableNodes = new WeakSet();
  // translation is handled in the service worker; no local translator cache
  let activeParagraphEl = null;
  let hoverOverlayEl = null;
  let backdropEl = null;
  let popupBodyRef = null;
  let popupWordsContainerEl = null;
  let overlayWordsContainerEl = null;
  let tipEl = null;
  let isDraggingPopup = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let popupContentEl = null;
  let dragListenersAttached = false;
  let currentDetectedLanguage = 'unknown';

  const progressCallbacks = new Map();

  const tooltip = createElement('div', `${EXT_CLS_PREFIX}-tooltip`, {}, { id: `${EXT_CLS_PREFIX}-tooltip`, innerText: '🧪 Click to learn in LangLab' });
  document.body.appendChild(tooltip);

  // ========== UTILITY FUNCTIONS ==========
  
  function createElement(tag, className, styles = {}, attributes = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    applyStyles(el, styles);
    for (const [key, value] of Object.entries(attributes)) {
      el[key] = value;
    }
    return el;
  }

  function applyStyles(element, styles) {
    for (const [key, value] of Object.entries(styles)) {
      element.style[key] = value;
    }
  }

  function scrollToBottom(element) {
    if (element) {
      // Use requestAnimationFrame to ensure scrolling happens after the DOM update
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    }
  }

  const BUTTON_STYLES = {
    primary: {
      padding: '8px 12px',
      background: '#2563eb',
      border: 'none',
      color: '#fff',
      fontSize: '13px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
    },
    secondary: {
      padding: '8px 12px',
      background: 'rgba(31,41,55,0.7)',
      border: '1px solid rgba(75,85,99,0.8)',
      color: '#e5e7eb',
      fontSize: '13px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
    }
  };

  function createButton(text, styleType = 'primary', onClick) {
    const btn = createElement('button', '', BUTTON_STYLES[styleType]);
    btn.classList.add(styleType);
    btn.textContent = text;
    if (onClick) btn.addEventListener('click', onClick);
    return btn;
  }

  function animateVocabButton() {
    const vocabBtn = document.querySelector(`.${EXT_CLS_PREFIX}-btn-vocab`);
    if (vocabBtn) {
      vocabBtn.classList.add(`${EXT_CLS_PREFIX}-btn-vocab-animate`);
      setTimeout(() => {
        vocabBtn.classList.remove(`${EXT_CLS_PREFIX}-btn-vocab-animate`);
      }, 500);
    }
  }

  function createSaveToVocabButton(translationText) {
    const saveBtn = createButton('Add to Vocab', 'primary');
    
    saveBtn.addEventListener('click', async () => {
      animateVocabButton();
      try {
        const result = await saveWordToVocab(translationText.trim());
        if (result.success) {
          if (result.isNewWord) {
            saveBtn.textContent = 'Added!';
            saveBtn.style.background = '#2563eb';
          } else {
            saveBtn.textContent = 'Updated!';
            saveBtn.style.background = '#f59e0b';
          }
        } else {
          saveBtn.textContent = 'Already exists';
          saveBtn.style.background = '#6b7280';
        }
        setTimeout(() => {
          saveBtn.textContent = 'Add to Vocab';
          saveBtn.style.background = '#2563eb';
        }, 1500);
      } catch (error) {
        saveBtn.textContent = 'Error';
        saveBtn.style.background = '#ef4444';
        setTimeout(() => {
          saveBtn.textContent = 'Add to Vocab';
          saveBtn.style.background = '#2563eb';
        }, 1500);
      }
    });
    
    return saveBtn;
  }

  // ========== DRAG & INTERACTION HANDLERS ==========

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
    if (htmlLang && htmlLang !== 'und' && htmlLang !== 'unknown') return htmlLang.toLowerCase();
    // Try common meta
    const metaLang = document.querySelector('meta[http-equiv="content-language" i]');
    if (metaLang && metaLang.content) {
      const lang = metaLang.content.split(',')[0].trim().toLowerCase();
      if (lang && lang !== 'und' && lang !== 'unknown') return lang;
    }
    const navLang = (navigator.language || '').trim();
    if (navLang && navLang !== 'und' && navLang !== 'unknown') return navLang.toLowerCase();
    return 'en';
  }

  async function saveWordToVocab(translationText) {
    try {
      let detectedLanguage = currentDetectedLanguage;
      if (window.currentLanguageDetectionPromise) {
        try {
          detectedLanguage = await window.currentLanguageDetectionPromise;
        } catch (error) {
          console.error('Error waiting for language detection:', error);
        }
      }

      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_WORD_TO_VOCAB',
        selectedWord: selectedWords.join(' ') || '',
        translationText: translationText,
        url: window.location.href,
        title: document.title,
        detectedLanguage: detectedLanguage
      });

      if (response && response.success) {
        return response;
      } else {
        throw new Error(response.error || 'Failed to save word');
      }
    } catch (error) {
      console.error('Failed to save word to vocabulary:', error);
      throw error;
    }
  }

  function ensureContainer() {
    if (textContainer && document.body.contains(textContainer)) return textContainer;
    textContainer = createElement('div', `${EXT_CLS_PREFIX}-container`, {
      all: 'initial',
      position: 'fixed',
      inset: '0px',
      pointerEvents: 'none',
      zIndex: '2147483647'
    });
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
    backdropEl = createElement('div', `${EXT_CLS_PREFIX}-backdrop`, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      backdropFilter: 'none',
      webkitBackdropFilter: 'none',
      background: 'transparent',
      zIndex: '2147483646'
    });
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
    tipEl = createElement('div', `${EXT_CLS_PREFIX}-tip`, {
      position: 'fixed',
      left: `${position.x}px`,
      top: `${position.y}px`,
      transform: position.transform,
      width: '280px',
      pointerEvents: 'auto',
      background: 'rgba(17,24,39,0.98)',
      color: '#e5e7eb',
      borderRadius: '12px',
      boxShadow: '0 12px 24px rgba(0,0,0,0.75)',
      zIndex: '2147483647'
    });

    // Use global selectedWords state
    const selectedWord = selectedWords.join(' ') || '';
    
    if (selectedWord && !isTranslating) {
      const wordHeader = createElement('div', '', {
        fontSize: '11px',
        color: 'rgba(209,213,219,0.8)',
        marginBottom: '3px',
        fontWeight: '500'
      });
      wordHeader.textContent = `"${selectedWord}"`;
      tipEl.appendChild(wordHeader);
    }

    const body = createElement('div', '', {
      fontSize: '13px',
      color: '#e5e7eb',
      wordBreak: 'break-word',
    });
    body.textContent = isTranslating ? 'Translating…' : (text || '');
    tipEl.appendChild(body);

    // Add save button if we have translation text and selected word
    if (!isTranslating && text && text.trim() && selectedWord) {
      const saveBtn = createButton('📚 Add to Vocab', 'primary');
      applyStyles(saveBtn, {
        padding: '4px 6px',
        fontSize: '11px',
        marginTop: '4px',
        fontWeight: '500'
      });
      
      saveBtn.addEventListener('click', async () => {
        animateVocabButton();
        try {
          const result = await saveWordToVocab(text.trim());
          if (result.success) {
            saveBtn.textContent = result.isNewWord ? 'Added!' : 'Updated!';
            saveBtn.style.background = result.isNewWord ? '#2563eb' : '#f59e0b';
          } else {
            saveBtn.textContent = 'Already exists';
            saveBtn.style.background = '#6b7280';
          }
          setTimeout(() => {
            saveBtn.textContent = 'Add to Vocab';
            saveBtn.style.background = '#2563eb';
          }, 1500);
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

  // ========== TRANSLATION DISPLAY ==========

  function showLoadingIndicator(container, message, includeAnimation = true) {
    if (!container) return;
    container.innerHTML = '';
    
    if (includeAnimation) {
      const card = createElement('div', '', {
        border: '1px solid rgba(75,85,99,0.9)',
        background: 'rgba(17,24,39,0.9)',
        borderRadius: '12px',
        padding: '12px 14px',
        boxShadow: '0 8px 22px rgba(0,0,0,0.30)'
      });

      const wrapper = createElement('div', '', {
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      });
      
      const dot = createElement('div', '', {
        width: '10px',
        height: '10px',
        borderRadius: '9999px',
        background: '#60a5fa',
        opacity: '0.9'
      });
      
      const textEl = createElement('div', '', {
        fontSize: '18px',
        lineHeight: '1.7',
        color: '#f3f4f6',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
      });
      textEl.textContent = message || 'Translating…';
      
      wrapper.appendChild(dot);
      wrapper.appendChild(textEl);
      card.appendChild(wrapper)
      container.appendChild(card);
    } else {
      const wrap = createElement('div', '', {
        fontSize: '16px',
        color: '#e5e7eb'
      });
      wrap.textContent = message || 'Translating…';
      container.appendChild(wrap);
    }
  }

  function showTranslationResult(container, resultText) {
    if (!container) return;
    container.innerHTML = '';
    
    const card = createElement('div', '', {
      border: '1px solid rgba(75,85,99,0.9)',
      background: 'rgba(17,24,39,0.9)',
      borderRadius: '12px',
      padding: '12px 14px',
      boxShadow: '0 8px 22px rgba(0,0,0,0.30)'
    });

    const text = createElement('div', '', {
      fontSize: '18px',
      lineHeight: '1.7',
      color: '#f3f4f6',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif'
    });
    text.textContent = resultText || 'Translation not available.';
    card.appendChild(text);

    if (resultText && resultText.trim() && selectedWords.length > 0) {
      card.appendChild(createSaveToVocabButton(resultText));
    }

    container.appendChild(card);
  }

  function setOverlayTranslationLoading(message) {
    showLoadingIndicator(translationBodyEl, message, true);
  }

  function setPopupTranslationLoading(bodyEl, message) {
    showLoadingIndicator(bodyEl, message, true);
  }

  function setPopupTranslationResult(bodyEl, resultText) {
    showTranslationResult(bodyEl, resultText);
  }

  function renderQuestionClickableBlock(targetEl, text, beforeEl) {
    if (!targetEl) return;
    // Render a messenger-style left-aligned bubble for the question
    const row = createElement('div', `${EXT_CLS_PREFIX}-question-block`, {
      display: 'flex',
      justifyContent: 'flex-start',
      margin: '6px 0'
    });
    const bubble = createElement('div', '', {
      maxWidth: '85%',
      background: 'rgba(31,41,55,0.9)',
      border: '1px solid rgba(75,85,99,0.8)',
      color: '#e5e7eb',
      borderRadius: '14px',
      padding: '10px 12px'
    });
    const words = createElement('div', '', {
      lineHeight: '1.8',
      fontSize: '18px',
      color: '#e5e7eb'
    });
    renderClickableWords(words, text || '');
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
    const answerContainer = createElement('div', `${EXT_CLS_PREFIX}-answer-container`, {
      margin: '6px 0'
    });

    const row = createElement('div', '', {
      display: 'flex',
      justifyContent: 'flex-end',
      marginBottom: '4px'
    });

    const bubble = createElement('div', '', {
      maxWidth: '85%',
      background: '#2563eb',
      border: 'none',
      color: '#ffffff',
      borderRadius: '14px',
      padding: '10px 12px'
    });

    const body = createElement('div', '', {
      fontSize: '16px',
      lineHeight: '1.7',
      whiteSpace: 'pre-wrap'
    });
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

  function attachImageClickHandlers() {
    const images = document.querySelectorAll('img');
    images.forEach((img) => {
      if (img.dataset.weblangImageHandler) return;
      img.dataset.weblangImageHandler = 'processing';

      const processImage = () => {
        if (img.clientWidth > 250) {
          img.dataset.weblangImageHandler = 'true';
          addFloatingButtonToImage(img);
        } else {
          img.dataset.weblangImageHandler = 'ignored-small';
        }
      };

      if (img.complete && img.naturalWidth > 0) {
        processImage();
      } else {
        img.addEventListener('load', processImage, { once: true });
        img.addEventListener('error', () => {
          img.dataset.weblangImageHandler = 'ignored-error';
        }, { once: true });
      }
    });
  }
  
  function addFloatingButtonToImage(img) {
    // Create floating button container
    const buttonContainer = createElement('div', `${EXT_CLS_PREFIX}-image-button-container`, {
      position: 'absolute',
      top: '8px',
      right: '8px',
      zIndex: '1000',
      opacity: '1',
      transition: 'opacity 0.3s ease',
      pointerEvents: 'auto',
      maxWidth: '200px',
      maxHeight: '40px'
    });
    
    // Create the floating button
    const button = createButton('🧪 Discuss in LangLab', 'secondary');
    button.classList.add(`${EXT_CLS_PREFIX}-image-button`);
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      askQuestionAboutImage(img);
    });
    
    buttonContainer.appendChild(button);
    
    // Make image container relative positioned if not already
    const imgParent = img.parentElement;
    const computedStyle = window.getComputedStyle(imgParent);
    if (computedStyle.position === 'static') {
      imgParent.style.position = 'relative';
    }
    
    // Ensure the image is still visible and not affected by our changes
    if (!img.style.display || img.style.display === 'none') {
      img.style.display = 'block';
    }
    if (!img.style.maxWidth) {
      img.style.maxWidth = '100%';
    }
    if (!img.style.height) {
      img.style.height = 'auto';
    }
    
    // Make sure the image is not hidden by our button
    img.style.zIndex = '1';
    img.style.position = 'relative';
    
    // Insert button into the image's parent container
    imgParent.appendChild(buttonContainer);
  }
  
  
  function askQuestionAboutImage(img) {
    // Use the same popup system as text questions
    openOverlayForImage(img);
  }
  
  async function openOverlayForImage(img) {
    if (!img) return;

    const centeredPosition = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      transform: 'translate(-50%, -50%)'
    };

    // A shared function to create and position the popup once the image is ready
    const createAndPositionPopup = (loadedImg) => {
      const rect = loadedImg.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        console.warn('Image has no dimensions, cannot open overlay.');
        if (popupEl) popupEl.style.display = 'none';
        return;
      }
      
      const popup = createImagePopup(centeredPosition);
      
      // Clear any loading state
      popup.bodyEl.innerHTML = '';
      
      const imgPreview = createElement('div', '', {
        marginBottom: '12px',
        textAlign: 'center',
        borderRadius: '8px',
        overflow: 'hidden'
      });
      
      const imgClone = loadedImg.cloneNode(true);
      imgClone.style.maxWidth = '100%';
      imgClone.style.maxHeight = '200px';
      imgClone.style.borderRadius = '8px';
      imgClone.style.cursor = 'default';
      imgClone.style.opacity = '1';
      imgClone.style.objectFit = 'contain';
      imgPreview.appendChild(imgClone);
      
      popup.bodyEl.appendChild(imgPreview);
      
      const questionContainer = createElement('div', `${EXT_CLS_PREFIX}-image-question-container`);
      popup.bodyEl.appendChild(questionContainer);
      popupBodyRef = questionContainer;
      
      const controls = buildControlsBar('image-popup', '');
      popupEl.appendChild(popup.bodyEl); // Add body before controls
      popupEl.appendChild(controls);

      // Automatically trigger the first question
      const askBtn = popupEl.querySelector(`.${EXT_CLS_PREFIX}-btn-ask`);
      if (askBtn) {
        askBtn.click();
      }
    };

    // If the image is already loaded and has dimensions, open the popup immediately
    if (img.complete && img.naturalWidth > 0) {
      createAndPositionPopup(img);
    } else {
      // If the image is not yet loaded, show a temporary loading state
      const popup = createImagePopup(centeredPosition);
      popup.bodyEl.textContent = 'Loading image...';
      
      // And wait for it to load before positioning the final popup
      img.addEventListener('load', () => {
        createAndPositionPopup(img);
      }, { once: true });
      
      img.addEventListener('error', () => {
        if (popupEl) popupEl.style.display = 'none';
        console.error('Image failed to load.');
      }, { once: true });
    }
  }
  
  async function generateImageQuestion(img, container) {
    try {
      let imageData;
      try {
        imageData = await getImageDataViaServiceWorker(img);
      } catch (error) {
        showTranslationResult(container, `Error: ${error.message}`);
        return;
      }
      
      let base64Data = null;
      let mimeType = 'image/jpeg';
      
      try {
        console.log('Converting blob to base64 in content script, size:', imageData.size, 'type:', imageData.type);
        const arrayBuffer = await imageData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        console.log('ArrayBuffer size:', arrayBuffer.byteLength, 'Uint8Array length:', uint8Array.length);
        
        let binaryString = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.slice(i, i + chunkSize);
          binaryString += String.fromCharCode.apply(null, chunk);
        }
        base64Data = btoa(binaryString);
        mimeType = imageData.type || 'image/jpeg';
        console.log('Base64 conversion complete, length:', base64Data.length, 'mimeType:', mimeType);
        } catch (error) {
          console.error('Error converting blob to base64:', error);
          showTranslationResult(container, `Error: ${error.message}`);
          return;
        }
      
      const requestId = `weblang_image_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      return new Promise((resolve, reject) => {
        const onResult = async (e) => {
          try {
            if (!e || !e.detail || e.detail.id !== requestId) return;
            window.removeEventListener('weblang-image-result', onResult, true);
            clearTimeout(timeoutId);
            if (e.detail.ok) {
              const question = e.detail.result || '';
              if (question) {
                await displayImageQuestion(question, container, img);
              }
              resolve(question);
            } else {
              const errMsg = e.detail.error || 'Failed to generate question';
              showTranslationResult(container, `Error: ${errMsg}`);
              reject(new Error(errMsg));
            }
          } catch (err) {
            window.removeEventListener('weblang-image-result', onResult, true);
            clearTimeout(timeoutId);
            reject(err);
          }
        };
        
        const timeoutId = setTimeout(() => {
          window.removeEventListener('weblang-image-result', onResult, true);
          showTranslationResult(container, 'Timeout: Request took too long');
          reject(new Error('Image question generation timeout'));
        }, 30000);
        
        window.addEventListener('weblang-image-result', onResult, true);
        
        try {
          console.log('Sending image request to service worker:', requestId);
          chrome.runtime && chrome.runtime.sendMessage({ 
            type: 'WEBLANG_IMAGE_REQUEST', 
            id: requestId, 
            imageData: base64Data,
            mimeType: mimeType,
            language: getDocumentLanguage() || 'en'
          });
        } catch (err) {
          console.error('Error sending image request:', err);
          window.removeEventListener('weblang-image-result', onResult, true);
          reject(err);
        }
      });
    } catch (error) {
      console.error('Error generating image question:', error);
    }
  }
  
  async function getImageDataViaServiceWorker(img) {
    return new Promise((resolve, reject) => {
      // For data URLs or blob URLs, we can use them directly
      if (img.src.startsWith('data:') || img.src.startsWith('blob:')) {
        fetch(img.src)
          .then(response => response.blob())
          .then(blob => {
            if (blob && blob.size > 0) {
              resolve(blob);
            } else {
              reject(new Error('Invalid blob data'));
            }
          })
          .catch(reject);
        return;
      }
      
      // Use service worker to fetch image data (bypasses CORS)
      const requestId = `weblang_image_fetch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      
      const onResult = (e) => {
        try {
          if (!e || !e.detail || e.detail.id !== requestId) return;
          window.removeEventListener('weblang-image-fetch-result', onResult, true);
          if (e.detail.ok) {
            const base64Data = e.detail.result;
            const mimeType = e.detail.mimeType || 'image/jpeg';
            
            if (base64Data) {
              try {
                console.log('Image MIME type:', mimeType);
                console.log('Base64 data length:', base64Data.length);
                
                // Convert base64 back to blob
                const binaryString = atob(base64Data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                // Ensure we have a valid image MIME type
                let finalMimeType = mimeType;
                if (!mimeType.startsWith('image/')) {
                  finalMimeType = 'image/jpeg'; // Default to JPEG
                }
                
                const blob = new Blob([bytes], { type: finalMimeType });
                console.log('Created blob:', blob.size, 'bytes, type:', blob.type);
                resolve(blob);
              } catch (error) {
                reject(new Error(`Failed to decode image data: ${error.message}`));
              }
            } else {
              reject(new Error('No data received from service worker'));
            }
          } else {
            const errMsg = e.detail.error || 'Failed to fetch image';
            reject(new Error(errMsg));
          }
        } catch (err) {
          window.removeEventListener('weblang-image-fetch-result', onResult, true);
          reject(err);
        }
      };
      
      window.addEventListener('weblang-image-fetch-result', onResult, true);
      
      try {
        chrome.runtime && chrome.runtime.sendMessage({ 
          type: 'WEBLANG_IMAGE_FETCH', 
          id: requestId, 
          imageUrl: img.src
        });
      } catch (err) {
        window.removeEventListener('weblang-image-fetch-result', onResult, true);
        reject(err);
      }
    });
  }
  
  async function getLearningLanguage() {
    try {
      if (!chrome.storage || !chrome.storage.local) return null;
      const conf = await new Promise((resolve) => chrome.storage.local.get(['weblangLearnLang'], (r)=> resolve(r||{})));
      return conf && conf.weblangLearnLang ? conf.weblangLearnLang : null;
    } catch { return null; }
  }

  async function translateQuestionToLearningLanguage(question) {
    const learnLang = await getLearningLanguage();
    const targetLang = learnLang || getDocumentLanguage() || 'en';
    const translated = await translateTo(question, targetLang, 'en');
    return translated || question || '';
  }

  async function generateAndTranslateQuestion(selectedText, existingQuestions = [], conversationHistory = []) {
    const q = await askQuestionWithPromptAPI(selectedText, existingQuestions, conversationHistory);
    return await translateQuestionToLearningLanguage(q);
  }

  async function displayImageQuestion(question, container, img) {
    const hasExistingContent = container.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
    if (!hasExistingContent) {
      container.innerHTML = '';
    }
    
    const finalQuestion = await translateQuestionToLearningLanguage(question);
    const targetLang = (await getLearningLanguage()) || getDocumentLanguage() || 'en';
    
    const inputContainer = container.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
    
    // Use the same question display as text popups with proper styling
    renderQuestionClickableBlock(container, finalQuestion, inputContainer);
    scrollToBottom(container.parentElement);
    
    // Use the same response controls as text popups
    if (!inputContainer) {
      attachResponseControls(container, targetLang);
    }
  }

  function attachResponseControls(targetEl, detectedLang) {
    const lang = (detectedLang && detectedLang !== 'unknown') ? detectedLang : getDocumentLanguage() || 'en';
    
    // Create input container that will be positioned at the bottom
    const inputContainer = createElement('div', `${EXT_CLS_PREFIX}-input-container`, {
      position: 'sticky',
      bottom: '0',
      padding: '12px 0',
      borderTop: '1px solid rgba(75,85,99,0.3)',
      marginTop: '12px'
    });

    const row = createElement('div', '', {
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    });

    const input = createElement('input', '', {
      flex: '1',
      padding: '10px 12px',
      borderRadius: '8px',
      border: '1px solid rgba(75,85,99,0.8)',
      background: 'rgba(31,41,55,0.7)',
      color: '#e5e7eb',
      fontSize: '14px'
    });
    input.type = 'text';
    input.placeholder = 'Type your answer…';

    const right = createElement('div', '', {
      display: 'flex',
      gap: '8px'
    });

    const micBtn = createButton('', 'secondary');
    applyStyles(micBtn, {
      padding: '8px',
      minWidth: '40px'
    });
    micBtn.title = 'Speak your answer';
    micBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="currentColor"/>
        <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10H7V12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12V10H19Z" fill="currentColor"/>
        <path d="M11 22H13V24H11V22Z" fill="currentColor"/>
        <path d="M7 22H17V24H7V22Z" fill="currentColor"/>
      </svg>
    `;
    
    // Add hover effects
    micBtn.addEventListener('mouseenter', () => {
      if (!isRecording) {
        micBtn.style.background = 'rgba(55,65,81,0.9)';
      }
    });
    
    micBtn.addEventListener('mouseleave', () => {
      if (!isRecording) {
        micBtn.style.background = 'rgba(31,41,55,0.7)';
      }
    });

    const sendBtn = createButton('Send', 'primary');

    right.appendChild(micBtn);
    right.appendChild(sendBtn);
    row.appendChild(input);
    row.appendChild(right);
    inputContainer.appendChild(row);
    targetEl.appendChild(inputContainer);

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    
    async function startAudioRecording() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
        
        audioChunks = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          await processAudioInput(audioBlob);
          stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        return true;
      } catch (error) {
        console.error('Error starting audio recording:', error);
        return false;
      }
    }
    
    function stopAudioRecording() {
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
      }
    }
    
    async function processAudioInput(audioBlob) {
      try {
        // Display the recorded audio in the chat
        displayRecordedAudio(audioBlob);
        
        // Send audio blob directly to AI teacher for processing
        await sendAudioToTeacher(audioBlob);
      } catch (error) {
        console.error('Error processing audio:', error);
        // Reset button state on error
        resetMicButton();
      }
    }
    
    
    function resetMicButton() {
      micBtn.style.background = 'rgba(31,41,55,0.7)';
      micBtn.style.color = '#e5e7eb';
      micBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" fill="currentColor"/>
          <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10H7V12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12V10H19Z" fill="currentColor"/>
          <path d="M11 22H13V24H11V22Z" fill="currentColor"/>
          <path d="M7 22H17V24H7V22Z" fill="currentColor"/>
        </svg>
      `;
      micBtn.title = 'Speak your answer';
    }
    
    function displayRecordedAudio(audioBlob) {
      // Create audio message container
      const audioContainer = createElement('div', `${EXT_CLS_PREFIX}-audio-message`, {
        margin: '8px 0',
        padding: '12px',
        background: 'rgba(31,41,55,0.7)',
        borderRadius: '12px',
        border: '1px solid rgba(75,85,99,0.3)'
      });
      
      // Create audio element
      const audio = createElement('audio', '', {
        width: '100%',
        marginBottom: '8px'
      });
      audio.controls = true;
      audio.src = URL.createObjectURL(audioBlob);
      
      // Create processing indicator
      const processingDiv = createElement('div', `${EXT_CLS_PREFIX}-processing`, {
        color: '#9ca3af',
        fontSize: '14px',
        fontStyle: 'italic'
      });
      processingDiv.textContent = 'Processing audio...';
      
      // Add elements to container
      audioContainer.appendChild(audio);
      audioContainer.appendChild(processingDiv);
      
      // Insert before the input container
      targetEl.insertBefore(audioContainer, inputContainer);
      
      // Store references for later updates
      audioContainer._processingDiv = processingDiv;
      audioContainer._audioBlob = audioBlob;
      
      return audioContainer;
    }
    
    async function sendAudioToTeacher(audioBlob) {
      try {
        // Update processing display
        const audioContainers = targetEl.querySelectorAll(`.${EXT_CLS_PREFIX}-audio-message`);
        const latestContainer = audioContainers[audioContainers.length - 1];
        if (latestContainer && latestContainer._processingDiv) {
          latestContainer._processingDiv.textContent = 'Sending to AI teacher...';
        }
        
        // Send to AI teacher for explanation
        const requestId = `weblang_teacher_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        
        return new Promise((resolve, reject) => {
          const onResult = (e) => {
            try {
              if (!e || !e.detail || e.detail.id !== requestId) return;
              window.removeEventListener('weblang-teacher-result', onResult, true);
              if (e.detail.ok) {
                const explanation = e.detail.result || '';
                if (explanation && latestContainer) {
                  // Update processing indicator
                  if (latestContainer._processingDiv) {
                    latestContainer._processingDiv.style.display = 'none';
                  }
                  
                  // Add teacher's explanation
                  const explanationDiv = createElement('div', `${EXT_CLS_PREFIX}-teacher-explanation`, {
                    marginTop: '8px',
                    padding: '8px',
                    background: 'rgba(37,99,235,0.1)',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#e5e7eb'
                  });
                  explanationDiv.innerHTML = `<strong>AI Teacher:</strong> ${explanation}`;
                  latestContainer.appendChild(explanationDiv);
                }
                resolve(explanation);
              } else {
                const errMsg = e.detail.error || 'Teacher explanation failed';
                console.error('Teacher explanation error:', errMsg);
                if (latestContainer && latestContainer._processingDiv) {
                  latestContainer._processingDiv.textContent = 'Error processing audio';
                  latestContainer._processingDiv.style.color = '#ef4444';
                }
                reject(new Error(errMsg));
              }
            } catch (err) {
              window.removeEventListener('weblang-teacher-result', onResult, true);
              reject(err);
            }
          };
          
          window.addEventListener('weblang-teacher-result', onResult, true);
          
          try {
            chrome.runtime && chrome.runtime.sendMessage({ 
              type: 'WEBLANG_TEACHER_REQUEST', 
              id: requestId, 
              audioBlob: audioBlob,
              language: lang || 'en'
            });
          } catch (err) {
            window.removeEventListener('weblang-teacher-result', onResult, true);
            reject(err);
          }
        });
      } catch (error) {
        console.error('Error sending to teacher:', error);
      }
    }

    micBtn.addEventListener('click', async () => {
      if (isRecording) {
        // Stop recording
        stopAudioRecording();
        resetMicButton();
        input.disabled = false;
        input.placeholder = 'Type your answer…';
        return;
      }
      
      // Check if MediaRecorder is supported
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        micBtn.title = 'Audio recording not supported in this browser';
        return;
      }
      
      // Set recording state with stop button
      micBtn.style.background = '#ef4444';
      micBtn.style.color = '#ffffff';
      micBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>
        </svg>
      `;
      micBtn.title = 'Click to stop recording';
      
      // Start recording
      const success = await startAudioRecording();
      if (!success) {
        resetMicButton();
        micBtn.title = 'Failed to start audio recording. Please check microphone permissions.';
      } else {
        input.disabled = true;
        input.placeholder = 'Recording audio...';
      }
    });

    async function handleSend() {
      const txt = (input.value || '').trim();
      if (!txt) return;
      
      // Hide input while processing
      inputContainer.style.display = 'none';
      
      const answerContainer = renderResponseCard(targetEl, txt, inputContainer);
      const isImageQuestion = targetEl.classList.contains(`${EXT_CLS_PREFIX}-image-question-container`);
      scrollToBottom(isImageQuestion ? targetEl.parentElement : targetEl);
      
      // Show "Thinking..." state on the ask button
      setActionButtonsDisabled(true, ['Evaluating...', 'Checking...', 'Almost there...']);
      const askBtn = popupEl ? popupEl.querySelector(`.${EXT_CLS_PREFIX}-btn-ask`) : null;
      if (askBtn) {
        askBtn.textContent = 'Thinking…';
      }
      
      // Evaluate the answer using Prompt API (page-side) when available
      try {
        const requestId = `weblang_eval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const questionEl = Array.from(targetEl.querySelectorAll(`.${EXT_CLS_PREFIX}-question-block`)).pop();
        const questionText = questionEl ? questionEl.textContent.trim().replace(/^Question/, '').trim() : 'Describe the image.';

        const contextText = isImageQuestion ?
          'Image-based question' :
          (overlayWordsContainerEl && overlayWordsContainerEl.textContent) || (popupWordsContainerEl && popupWordsContainerEl.textContent) || '';

        const conversationHistory = [];
        if (targetEl) {
            const children = Array.from(targetEl.children);
            for (const child of children) {
                if (child.classList.contains(`${EXT_CLS_PREFIX}-question-block`)) {
                    const qText = (child.textContent || '').trim().replace(/^Question/, '').trim();
                    if (qText) {
                        conversationHistory.push({ role: 'assistant', content: qText });
                    }
                } else if (child.classList.contains(`${EXT_CLS_PREFIX}-answer-container`)) {
                    const answerBubble = child.querySelector('div > div[style*="background: rgb(37, 99, 235)"]');
                    if (answerBubble) {
                        const answerText = answerBubble.textContent.trim();
                        if (answerText) {
                            conversationHistory.push({ role: 'user', content: answerText });
                        }
                    }
                    const evaluationEl = child.querySelector('div[style*="font-style: italic"]');
                    if (evaluationEl) {
                        const evaluationText = evaluationEl.textContent.trim();
                        if (evaluationText) {
                            conversationHistory.push({ role: 'assistant', content: evaluationText });
                        }
                    }
                }
            }
        }

        const onEval = async (e) => {
          try {
            if (!e || !e.detail || e.detail.id !== requestId) return;
            window.removeEventListener('weblang-eval-result', onEval, true);
            const result = (e.detail && e.detail.ok && e.detail.result) ? e.detail.result : (e.detail && e.detail.error ? e.detail.error : 'No evaluation.');
            
            const translatedResult = await translateQuestionToLearningLanguage(result);

            const inputContainer = targetEl.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
            renderQuestionClickableBlock(targetEl, translatedResult, inputContainer);
            
            const isImageQuestion = targetEl.classList.contains(`${EXT_CLS_PREFIX}-image-question-container`);
            scrollToBottom(isImageQuestion ? targetEl.parentElement : targetEl);

            // Re-enable ask button for follow-up questions
            setActionButtonsDisabled(false);
            if (askBtn) {
              askBtn.textContent = 'Ask a follow-up';
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
        chrome.runtime && chrome.runtime.sendMessage({ type: 'WEBLANG_EVAL_REQUEST', id: requestId, question: questionText, answer: txt, context: contextText, history: conversationHistory });
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

  // removed local getLanguageDetector; detection runs in service worker

  async function detectLanguageCode(text, onProgress) {
    const requestId = `detect-${Date.now()}-${Math.random()}`;
    if (onProgress) {
      progressCallbacks.set(requestId, onProgress);
    }
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DETECT_LANGUAGE',
        text,
        requestId
      });
      if (response.success) {
        return response.result;
      }
      throw new Error(response.error || 'Language detection failed');
    } finally {
      progressCallbacks.delete(requestId);
    }
  }

  async function translateTo(text, targetLang, sourceLangOpt, onProgress) {
    const requestId = `translate-to-${Date.now()}-${Math.random()}`;
    try {
      if (onProgress) {
        progressCallbacks.set(requestId, onProgress);
      }
      const response = await chrome.runtime.sendMessage({
        type: 'TRANSLATE_TEXT',
        text,
        targetLang,
        sourceLang: sourceLangOpt || getDocumentLanguage(),
        requestId
      });
      if (response && response.success) {
        return response.result;
      }
      return null;
    } catch {
      return null;
    } finally {
      if (onProgress) {
        progressCallbacks.delete(requestId);
      }
    }
  }

  // Prompt API (Gemini Nano) helper executed in the PAGE context (not content script)
  async function askQuestionWithPromptAPI(selectedText, existingQuestions = [], conversationHistory = []) {
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
            reject(new Error(errMsg));
          }
        } catch (err) {
          window.removeEventListener('weblang-prompt-result', onResult, true);
          reject(err);
        }
      };
      window.addEventListener('weblang-prompt-result', onResult, true);
      try {
        if (!chrome.runtime?.id) {
          return reject(new Error("Extension context invalidated. Please reload the page."));
        }
        chrome.runtime && chrome.runtime.sendMessage({ 
          type: 'WEBLANG_PROMPT_REQUEST', 
          id: requestId, 
          text: String(selectedText||''),
          existingQuestions: existingQuestions,
          history: conversationHistory
        });
      } catch (err) {
        window.removeEventListener('weblang-prompt-result', onResult, true);
        reject(err);
      }
    });
  }

  function buildControlsBar(context, selectedText) {
    const bar = createElement('div', `${EXT_CLS_PREFIX}-controls`, {
      display: 'grid',
      gridTemplateColumns: context === 'sidebar' ? '1fr auto' : '1fr auto',
      alignItems: 'center',
      gap: '10px',
      marginTop: '10px'
    });

    const centerWrap = createElement('div', '', {
      display: 'flex',
      justifyContent: 'center',
      gap: '8px'
    });

    const btnAsk = createButton('Ask me a question', 'primary');
    btnAsk.classList.add(`${EXT_CLS_PREFIX}-btn-ask`);
    
    btnAsk.addEventListener('click', async () => {
      try {
        setActionButtonsDisabled(true, ['Reading...', 'Thinking...', 'Formulating question...']);
        if (context === 'image-popup') {
          const img = popupEl ? popupEl.querySelector('img') : null;
          if (img && popupBodyRef) {
            const hasExistingContent = popupBodyRef.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
            if (!hasExistingContent) {
              showLoadingIndicator(popupBodyRef, 'Generating question…', true);
            }
            await generateImageQuestion(img, popupBodyRef);
          }
        } else if (context === 'popup') {
          if (popupBodyRef) {
            // Check if this is the first question or a follow-up
            const hasExistingContent = popupBodyRef.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
            if (!hasExistingContent) {
              setPopupTranslationLoading(popupBodyRef, 'Generating question…');
            }
            
            // Collect existing questions for context
            const existingQuestions = [];
            const conversationHistory = [];
            const messageContainer = popupBodyRef;
            if (messageContainer) {
                const children = Array.from(messageContainer.children);
                for (const child of children) {
                    if (child.classList.contains(`${EXT_CLS_PREFIX}-question-block`)) {
                        const questionText = (child.textContent || '').trim().replace(/^Question/, '').trim();
                        if (questionText) {
                            existingQuestions.push(questionText);
                            conversationHistory.push({ role: 'assistant', content: questionText });
                        }
                    } else if (child.classList.contains(`${EXT_CLS_PREFIX}-answer-container`)) {
                        const answerBubble = child.querySelector('div > div[style*="background: rgb(37, 99, 235)"]');
                        if (answerBubble) {
                            const answerText = answerBubble.textContent.trim();
                            if (answerText) {
                                conversationHistory.push({ role: 'user', content: answerText });
                            }
                        }
                        const evaluationEl = child.querySelector('div[style*="font-style: italic"]');
                        if (evaluationEl) {
                            const evaluationText = evaluationEl.textContent.trim();
                            if (evaluationText) {
                                conversationHistory.push({ role: 'assistant', content: evaluationText });
                            }
                        }
                    }
                }
            }
            
            const finalQ = await generateAndTranslateQuestion(selectedText, existingQuestions, conversationHistory);
            if (popupBodyRef) {
              // Insert question before the input container if it exists
              const inputContainer = popupBodyRef.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
              const wordsEl = renderQuestionClickableBlock(popupBodyRef, finalQ, inputContainer);
              popupWordsContainerEl = wordsEl;
              // Only attach response controls if this is the first question
              if (!hasExistingContent) {
                attachResponseControls(popupBodyRef, currentDetectedLanguage);
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
          const conversationHistory = [];
          const messageContainer = translationBodyEl;
          if (messageContainer) {
              const children = Array.from(messageContainer.children);
              for (const child of children) {
                  if (child.classList.contains(`${EXT_CLS_PREFIX}-question-block`)) {
                      const questionText = (child.textContent || '').trim().replace(/^Question/, '').trim();
                      if (questionText) {
                          existingQuestions.push(questionText);
                          conversationHistory.push({ role: 'assistant', content: questionText });
                      }
                  } else if (child.classList.contains(`${EXT_CLS_PREFIX}-answer-container`)) {
                      const answerBubble = child.querySelector('div > div[style*="background: rgb(37, 99, 235)"]');
                      if (answerBubble) {
                          const answerText = answerBubble.textContent.trim();
                          if (answerText) {
                              conversationHistory.push({ role: 'user', content: answerText });
                          }
                      }
                      const evaluationEl = child.querySelector('div[style*="font-style: italic"]');
                      if (evaluationEl) {
                          const evaluationText = evaluationEl.textContent.trim();
                          if (evaluationText) {
                              conversationHistory.push({ role: 'assistant', content: evaluationText });
                          }
                      }
                  }
              }
          }
          
          const finalQ = await generateAndTranslateQuestion(selectedText, existingQuestions, conversationHistory);
          // Append new question instead of replacing
          if (hasExistingContent) {
            // Insert question before the input container
            const inputContainer = translationBodyEl.querySelector(`.${EXT_CLS_PREFIX}-input-container`);
            renderQuestionClickableBlock(translationBodyEl, finalQ, inputContainer);
          } else {
            translationBodyEl.innerHTML = '';
            renderQuestionClickableBlock(translationBodyEl, finalQ);
            attachResponseControls(translationBodyEl, currentDetectedLanguage);
          }
          scrollToBottom(translationBodyEl);
          // Update input visibility after adding question
          updateInputVisibility(translationBodyEl);
        }
      } catch (e) {
        const msg = (e && e.message) ? e.message : 'Unable to generate a question.';
        if (context === 'popup') {
          if (popupBodyRef) setPopupTranslationResult(popupBodyRef, msg);
        }

        throw e;
      } finally {
        setActionButtonsDisabled(false); 
        btnAsk.textContent = 'Ask another question';
      }
    });

    centerWrap.appendChild(btnAsk);

    // Add View Vocabulary button to the right side
    const btnVocab = createButton('📚 Vocab', 'secondary');
    btnVocab.classList.add(`${EXT_CLS_PREFIX}-btn-vocab`);
    btnVocab.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'OPEN_SIDEBAR_REQUEST' });
      } catch (error) {
        console.error('Failed to open sidebar:', error);
      }
    });

    // Order: language button (left), center content, vocab button (right)
    bar.appendChild(centerWrap);
    bar.appendChild(btnVocab);
    return bar;
  }

  let loadingIntervalId = null;
  function setActionButtonsDisabled(disabled, loadingTexts = []) {
    try {
      if (!popupEl) return;
      const askBtn = popupEl.querySelector(`.${EXT_CLS_PREFIX}-btn-ask`);

      if (askBtn) {
        askBtn.disabled = !!disabled;

        if (disabled) {
          askBtn.innerHTML = ''; // Clear button for spinner

          const spinner = createElement('div', `${EXT_CLS_PREFIX}-spinner`);
          askBtn.appendChild(spinner);
          
          const textSpan = createElement('span');
          askBtn.appendChild(textSpan);

          if (loadingTexts.length > 0) {
            let currentIndex = 0;
            textSpan.textContent = loadingTexts[currentIndex];
            loadingIntervalId = setInterval(() => {
              currentIndex = (currentIndex + 1) % loadingTexts.length;
              textSpan.textContent = loadingTexts[currentIndex];
            }, 1500);
          } else {
            textSpan.textContent = 'Loading...';
          }
          
          askBtn.style.position = 'relative';
          askBtn.style.overflow = 'hidden';
          askBtn.style.background = 'linear-gradient(45deg, #2563eb, #3b82f6, #60a5fa, #93c5fd)';
          askBtn.style.backgroundSize = '400% 400%';
          askBtn.style.animation = 'weblang-gradient-spin 1.5s ease-in-out infinite';
          askBtn.style.border = '2px solid transparent';
          askBtn.style.backgroundClip = 'padding-box';
          askBtn.style.boxShadow = '0 0 0 2px #2563eb, 0 0 0 4px rgba(37, 99, 235, 0.3)';
        } else {
          if (loadingIntervalId) {
            clearInterval(loadingIntervalId);
            loadingIntervalId = null;
          }
          askBtn.style.background = askBtn.classList.contains('primary') ? '#2563eb' : 'rgba(31,41,55,0.7)';
          askBtn.style.backgroundSize = '';
          askBtn.style.animation = '';
          askBtn.style.border = 'none';
          if (askBtn.classList.contains('secondary')) {
             askBtn.style.border = '1px solid rgba(75,85,99,0.8)';
          }
          askBtn.style.backgroundClip = '';
          askBtn.style.boxShadow = '';
        }
      }
    } catch {}
  }

  const POPUP_STYLES = {
    position: 'fixed',
    top: '48px',
    pointerEvents: 'auto',
    background: 'rgba(17,24,39,0.96)',
    border: '1px solid rgba(75,85,99,0.9)',
    color: '#e5e7eb',
    borderRadius: '12px',
    boxShadow: '0 16px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04) inset',
    padding: '14px',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif',
    backdropFilter: 'blur(2px)',
    webkitBackdropFilter: 'blur(2px)',
    zIndex: '2147483647'
  };

  // ========== DRAG & INTERACTION HANDLERS ==========

  function addDragHandlersToPopup(element) {
    attachDragListeners();
    element.addEventListener('mousedown', (e) => {
      if (isInteractiveTarget(e.target)) return;
      try {
        isDraggingPopup = true;
        const r = element.getBoundingClientRect();
        element.style.transform = 'none';
        dragOffsetX = e.clientX - r.left;
        dragOffsetY = e.clientY - r.top;
        e.preventDefault();
        e.stopPropagation();
      } catch {}
    });
  }

  function createImagePopup(position) {
    clearPopup();
    const container = ensureContainer();
    ensureBackdrop();
    
    const imagePopupStyles = {
      ...POPUP_STYLES,
      left: `${position.x}px`,
      top: `${position.y}px`,
      transform: position.transform,
      width: '480px',
      'max-height': '80vh',
      'display': 'flex',
      'flex-direction': 'column',
    };
    popupEl = createElement('div', `${EXT_CLS_PREFIX}-popup`, imagePopupStyles);
    
    addDragHandlersToPopup(popupEl);

    const body = createElement('div', '', {
      fontSize: '18px',
      color: '#e5e7eb',
      marginBottom: '8px',
      wordBreak: 'break-word',
      'overflow-y': 'auto',
      'flex-grow': '1'
    });
    
    // No translation UI for image popups
    popupEl.appendChild(body);
    container.appendChild(popupEl);

    // Animate popup
    popupEl.style.opacity = '0';
    popupEl.style.transform = `${position.transform} translateY(15px)`;
    popupEl.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';

    requestAnimationFrame(() => {
      popupEl.style.opacity = '1';
      popupEl.style.transform = position.transform;
    });

    return { bodyEl: body };
  }

  function createOverlayForText(rect, text, sourceParagraphEl) {
    clearPopup();
    const container = ensureContainer();
    ensureBackdrop();

    const textOverlayStyles = {
      ...POPUP_STYLES,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      overflow: 'visible',
      'max-height': '80vh',
      'display': 'flex',
      'flex-direction': 'column',
    };
    popupEl = createElement('div', `${EXT_CLS_PREFIX}-overlay`, textOverlayStyles);

    addDragHandlersToPopup(popupEl);

    const wordsContainer = createElement('div', '', {
      lineHeight: '1.8',
      fontSize: '19px',
      color: '#e5e7eb',
      marginBottom: '8px',
      'overflow-y': 'auto',
      'flex-shrink': '0'
    });

    renderClickableWords(wordsContainer, text);
    overlayWordsContainerEl = wordsContainer;

    translationBodyEl = createElement('div', '', {
      fontSize: '18px',
      color: '#e5e7eb',
      marginTop: '8px',
      'overflow-y': 'auto',
      'flex-grow': '1'
    });

    popupEl.appendChild(wordsContainer);
    popupEl.appendChild(translationBodyEl);
    const controlsBar = buildControlsBar('overlay', text);
    popupEl.appendChild(controlsBar);

    container.appendChild(popupEl);

    // Animate popup
    popupEl.style.opacity = '0';
    popupEl.style.transform = 'translateY(15px)';
    popupEl.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
    
    requestAnimationFrame(() => {
      popupEl.style.opacity = '1';
      popupEl.style.transform = 'translateY(0)';
    });

    // Manage paragraph styles while overlay is open
    if (sourceParagraphEl) {
      activeParagraphEl = sourceParagraphEl;
      // Remove hover overlay and clickable styling while active
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

  const addClickableStyles = () => {
    const styleId = `${EXT_CLS_PREFIX}-styles`;
    if (document.getElementById(styleId)) return;
 
    const style = createElement('style');
    style.id = styleId;
    style.textContent = `
      .${EXT_CLS_PREFIX}-clickable {
        cursor: pointer;
        position: relative;
        transition: background-color 0.15s ease, border-color 0.15s ease;
        border-radius: 8px;
        padding: 4px;
        border: 2px solid transparent;
      }
      .${EXT_CLS_PREFIX}-clickable:hover {
        background-color: rgba(59,130,246,0.08);
        border-color: rgba(59,130,246,0.5);
      }
      .${EXT_CLS_PREFIX}-selected {
        background-color: rgba(59,130,246,0.12) !important;
        box-shadow: inset 3px 0 0 rgba(59,130,246,0.7);
      }
      #${EXT_CLS_PREFIX}-tooltip {
        position: fixed;
        display: none;
        padding: 4px 8px;
        background: rgba(0,0,0,0.8);
        color: white;
        border-radius: 4px;
        font-size: 14px;
        font-family: sans-serif;
        z-index: 2147483647;
        pointer-events: none;
        white-space: nowrap;
      }
      .${EXT_CLS_PREFIX}-spinner {
        display: inline-block;
        width: 14px;
        height: 14px;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-radius: 50%;
        border-top-color: #fff;
        animation: weblang-spinner-anim 0.8s linear infinite;
        margin-right: 8px;
        vertical-align: -2px;
      }
      @keyframes weblang-spinner-anim {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  };

  async function openOverlayForElement(element, sourceParagraphEl, options = {}) {
    if (!element) {
      console.error('Element is undefined in openOverlayForElement');
      return;
    }
    
    element.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    
    if (!rect) {
      console.error('Failed to get bounding rect for element');
      return;
    }
    
    const text = element.innerText || element.textContent || '';
    createOverlayForText(rect, text, sourceParagraphEl || null);
  }

  function hasSubstantialText(element) {
    const text = element.textContent || element.innerText || '';
    const cleanText = text.trim();
    if (cleanText.length < 20) return false;
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

      clickableNodes.add(p);
      p.addEventListener('mouseover', (e) => {
        tooltip.style.display = 'block';
      });

      p.addEventListener('mouseout', (e) => {
        tooltip.style.display = 'none';
      });

      p.addEventListener('mousemove', (e) => {
        tooltip.style.left = `${e.clientX + 15}px`;
        tooltip.style.top = `${e.clientY + 15}px`;
      });
    });
  }

  function calculatePosition(rect) {
    if (!rect) {
      // Fallback position if rect is undefined
      return { x: 100, y: 100, transform: 'translate(-50%, 0%)' };
    }
    
    const popupWidth = 320;
    const popupHeight = 200;
    const margin = 15;
    const viewportWidth = window.innerWidth;

    const top = rect.top || 0;
    const bottom = rect.bottom || 0;
    const left = rect.left || 0;
    const width = rect.width || 0;

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
        const cleanWord = part.replace(/[^\p{L}\p{N}\s'-]/gu, '').trim();
        const span = createElement('span', `${EXT_CLS_PREFIX}-word`, {
          cursor: 'pointer',
          transition: 'color 150ms ease-in-out, background 150ms ease-in-out',
          borderBottom: '1px dashed rgba(156,163,175,0.6)',
          display: 'inline-block',
          padding: '0 2px'
        });
        span.textContent = part;

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

  // removed local translate; translation runs in service worker via translateTo

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
          
          if (!firstRect || !lastRect) {
            console.error('Failed to get bounding rect for spans');
            return;
          }
          const combinedRect = {
            top: firstRect.top,
            bottom: lastRect.bottom,
            left: firstRect.left,
            right: lastRect.right,
            width: lastRect.right - firstRect.left,
            height: lastRect.bottom - firstRect.top
          };
          const pos = calculatePosition(combinedRect);
          if (!pos) {
            console.error('Failed to calculate position for combined rect');
            return;
          }
          const { bodyEl } = createTipPopover(pos, selectedText, true);
          translateTo(selectedText, 'en', undefined, (msg)=>{ try { bodyEl.textContent = msg; } catch {} }).then((t) => {
            if (!tipEl) return;
            setPopupTranslationResult(bodyEl, t || 'Translation not available.');
          });
        }
      }
    }
  }

  function handlePageTextSelection(event) {
    // Ignore selections within the extension's popups/overlays
    if (event.target.closest(`.${EXT_CLS_PREFIX}-overlay, .${EXT_CLS_PREFIX}-popup, .${EXT_CLS_PREFIX}-tip, .${EXT_CLS_PREFIX}-tooltip`)) {
      return;
    }

    // Ignore if clicking on interactive elements, unless text is selected.
    if (isInteractiveTarget(event.target) && window.getSelection().toString().trim().length === 0) {
      return;
    }

    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        return;
      }

      const selectedText = selection.toString().trim();
      // Only trigger for meaningful selections
      if (selectedText.length > 1 && selectedText.split(' ').length < 100) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) {
          return; // Don't show for empty selections
        }

        // Check if the selection is inside an editable element, but allow if it has content
        const editableParent = range.startContainer.parentElement.closest('[contenteditable="true"]');
        if (editableParent && selectedText.length === 0) {
          return;
        }

        createOverlayForText(rect, selectedText, range.commonAncestorContainer.parentElement);
      }
    }, 10); // Use a small timeout to allow the selection to finalize
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

  // Listen for language settings updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RELOAD_LANGUAGE_SETTINGS') {
      console.log('Language settings updated, re-evaluating paragraphs...');
      // Clear existing clickable nodes and re-evaluate
      clickableNodes.clear();
      makeClickableParagraphs();
    }
    
    // Handle image fetch results from service worker
    if (message.type === 'WEBLANG_IMAGE_FETCH_RESULT') {
      const { id, ok, result, error, mimeType } = message;
      window.dispatchEvent(new CustomEvent('weblang-image-fetch-result', { 
        detail: { id, ok, result, error, mimeType } 
      }));
    }

    if (message.type === 'TRANSLATION_PROGRESS' && progressCallbacks.has(message.requestId)) {
      progressCallbacks.get(message.requestId)(message.message);
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'WEBLANG_PROMPT_RESULT') {
      const { id, ok, result, error } = event.data;
      window.dispatchEvent(new CustomEvent('weblang-prompt-result', { 
        detail: { id, ok, result, error } 
      }));
    }
  });

  // Initialize
  addClickableStyles();
  makeClickableParagraphs();
  attachImageClickHandlers();
  const observer = new MutationObserver(() => {
    makeClickableParagraphs();
    attachImageClickHandlers();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mouseup', handleGlobalMouseUp, true);
  document.addEventListener('mouseup', handlePageTextSelection, false);
  document.addEventListener('mousedown', handleClickOutside, true);
})();
