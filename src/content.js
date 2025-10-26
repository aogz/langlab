// Lightweight interactive word selection and popup translation using on-device Translator API
// No backend calls; runs entirely in content context.

(() => {
  const EXT_CLS_PREFIX = 'weblang-ext';

  let isDragging = false;
  let selectionStartIndex = null;
  let wordOrder = [];
  let selectedWords = [];
  let activeWordSelection = null;
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
  let activeLearnableEl = null;
  let isDraggingPopup = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let popupContentEl = null;
  let dragListenersAttached = false;
  let currentDetectedLanguage = 'unknown';
  const progressCallbacks = new Map();
  let pageVocabCount = 0;
  let vocabWidgetEl = null;
  let isActive = false;
  let observer = null;

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

  function startProcessingIndicator(element, texts) {
    if (!element || !texts || !texts.length) return () => {};
    let currentIndex = 0;
    const intervalId = setInterval(() => {
      element.textContent = texts[currentIndex];
      currentIndex = (currentIndex + 1) % texts.length;
    }, 2000);
    element.textContent = texts[currentIndex];
    currentIndex = (currentIndex + 1) % texts.length;
    return () => clearInterval(intervalId);
  }

  function renderSimpleMarkdown(text) {
    let html = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/```(javascript|js)?\n([\s\S]*?)```/g, (match, lang, code) => {
          return `<pre><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      })
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^\* (.*$)/gm, '<ul><li>$1</li></ul>')
      .replace(/<\/ul>\n<ul>/g, '')
      .replace(/\n/g, '<br>');

    // Clean up <br>s inside <pre>
    html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
      return `<pre><code>${code.replace(/<br>/g, '\n')}</code></pre>`;
    });

    return html;
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
        if (response.isNewWord) {
          pageVocabCount++;
          const vocabBtn = document.getElementById(`${EXT_CLS_PREFIX}-vocab-btn`);
          if (vocabBtn) {
            vocabBtn.textContent = `📚 Vocab (${pageVocabCount})`;
          }
        }
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
    const containerId = `${EXT_CLS_PREFIX}-main-container`;
    const existingContainer = document.getElementById(containerId);
    if (existingContainer) {
      textContainer = existingContainer;
      return textContainer;
    }
    textContainer = createElement('div', `${EXT_CLS_PREFIX}-container`, {
      all: 'initial',
      position: 'fixed',
      inset: '0px',
      pointerEvents: 'none',
      zIndex: '2147483647'
    }, { id: containerId });
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

  function closePopupWithAnimation() {
    if (!popupEl) return;

    const popupToClose = popupEl;
    const backdropToClose = backdropEl;

    // Clear global references immediately so no new actions can be taken on the closing popup
    popupEl = null;
    backdropEl = null;
    popupBodyRef = null;

    if (activeParagraphEl) {
      activeParagraphEl.classList.remove(`${EXT_CLS_PREFIX}-selected`);
      activeParagraphEl = null;
    }

    activeLearnableEl = null;

    if (activeParagraphEl) {
      activeParagraphEl.classList.add(`${EXT_CLS_PREFIX}-clickable`);
      activeParagraphEl = null;
    }

    // Animate out
    popupToClose.style.opacity = '0';
    if (popupToClose.className.includes(`${EXT_CLS_PREFIX}-overlay`)) {
      popupToClose.style.transform = 'translateY(15px)';
    } else {
      popupToClose.style.transform = 'translate(-50%, -50%) translateY(15px)';
    }

    if (backdropToClose) {
      backdropToClose.style.opacity = '0';
      backdropToClose.style.transition = 'opacity 0.4s ease-out';
    }

    // Remove from DOM after animation
    setTimeout(() => {
      if (popupToClose.parentNode) popupToClose.parentNode.removeChild(popupToClose);
      if (backdropToClose && backdropToClose.parentNode) backdropToClose.parentNode.removeChild(backdropToClose);
    }, 400); // This should match transition duration

    resetSelectionState();
  }

  function ensureBackdrop() {
    const container = ensureContainer();
    if (backdropEl && container.contains(backdropEl)) return backdropEl;
    
    // Create rectangular blue gradient border effect
    const createGradientBorder = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Use viewport dimensions
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // Create rectangular gradient from edges to center
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      
      // Add gradient stops for rectangular blue fade - smaller coverage
      gradient.addColorStop(0, 'rgba(135, 206, 250, 0.3)');     // Top-left corner
      gradient.addColorStop(0.15, 'rgba(135, 206, 250, 0.1)');  // Quick fade
      gradient.addColorStop(0.5, 'rgba(135, 206, 250, 0)');     // Center transparent
      gradient.addColorStop(0.85, 'rgba(135, 206, 250, 0.1)');  // Quick fade
      gradient.addColorStop(1, 'rgba(135, 206, 250, 0.3)');    // Bottom-right corner
      
      // Fill with gradient
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      return canvas.toDataURL();
    };
    
    backdropEl = createElement('div', `${EXT_CLS_PREFIX}-backdrop`, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      backdropFilter: 'none',
      webkitBackdropFilter: 'none',
      backgroundImage: `url(${createGradientBorder()})`,
      backgroundSize: '100% 100%',
      backgroundRepeat: 'no-repeat',
      opacity: '0',
      transition: 'opacity 0.4s ease-out',
      zIndex: '2147483646',
      animation: `${EXT_CLS_PREFIX}-gradient-pulse 3s ease-in-out infinite`
    });
    
    container.appendChild(backdropEl);
    
    // Fade in animation
    requestAnimationFrame(() => {
      backdropEl.style.opacity = '1';
    });
    
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

    const closeBtn = createElement('button', '', {
      position: 'absolute',
      top: '8px',
      right: '8px',
      background: 'transparent',
      border: 'none',
      color: '#9ca3af',
      cursor: 'pointer',
      padding: '4px'
    });
    closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.onclick = () => clearTip();
    tipEl.appendChild(closeBtn);

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
      transition: 'opacity 0.3s ease, transform 0.2s ease-in-out',
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
      img.scrollIntoView({ behavior: 'smooth', block: 'start' });
      askQuestionAboutImage(img, buttonContainer);
    });
    
    // Add hover effects
    buttonContainer.addEventListener('mouseenter', () => {
      buttonContainer.style.transform = 'translateY(-3px)';
    });
    buttonContainer.addEventListener('mouseleave', () => {
      buttonContainer.style.transform = 'translateY(0)';
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
  
  
  function askQuestionAboutImage(img, buttonContainer) {
    activeLearnableEl = buttonContainer;
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
      
      const topPosition = {
        x: window.innerWidth / 2,
        transform: 'translate(-50%, 0)'
      };
      const popup = createImagePopup(topPosition);
      
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
        }, 60000);
        
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

    // Add translation button
    const translateBtn = createButton('', 'secondary');
    applyStyles(translateBtn, {
      padding: '8px',
      minWidth: '40px'
    });
    translateBtn.title = 'Translate a word';
    translateBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/>
      </svg>
    `;
    
    // Add hover effects
    translateBtn.addEventListener('mouseenter', () => {
      translateBtn.style.background = 'rgba(55,65,81,0.9)';
    });
    
    translateBtn.addEventListener('mouseleave', () => {
      translateBtn.style.background = 'rgba(31,41,55,0.7)';
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

    // Add proofreader button
    const proofreaderBtn = createButton('', 'secondary');
    applyStyles(proofreaderBtn, {
      padding: '8px',
      minWidth: '40px'
    });
    proofreaderBtn.title = 'Check grammar and spelling';
    proofreaderBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="14,2 14,8 20,8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="16" y1="13" x2="8" y2="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="16" y1="17" x2="8" y2="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="10,9 9,9 8,9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    
    // Add hover effects
    proofreaderBtn.addEventListener('mouseenter', () => {
      proofreaderBtn.style.background = 'rgba(55,65,81,0.9)';
    });
    
    proofreaderBtn.addEventListener('mouseleave', () => {
      proofreaderBtn.style.background = 'rgba(31,41,55,0.7)';
    });

    right.appendChild(translateBtn);
    right.appendChild(proofreaderBtn);
    right.appendChild(micBtn);
    right.appendChild(sendBtn);
    row.appendChild(input);
    row.appendChild(right);
    inputContainer.appendChild(row);

    const loadingIndicator = createElement('div', `${EXT_CLS_PREFIX}-response-loading-indicator`, {
      display: 'none',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: '#d1d5db',
      justifyContent: 'center',
      minWidth: '108px'
    });
    const spinner = createElement('div', `${EXT_CLS_PREFIX}-spinner`);
    const loadingTextSpan = createElement('span');
    loadingIndicator.appendChild(spinner);
    loadingIndicator.appendChild(loadingTextSpan);
    row.appendChild(loadingIndicator);
    
    inputContainer.appendChild(row);
    targetEl.appendChild(inputContainer);

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recognition = null;
    let currentTranscript = '';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      
      getLearningLanguage().then(lang => {
        recognition.lang = lang || 'en-US';
        console.log(`[LangLab] Speech recognition language set to: ${recognition.lang}`);
      });

      recognition.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript;
        console.log('[LangLab] Live transcript result:', transcript);
        currentTranscript = transcript.trim();
        if (input) {
          input.value = currentTranscript;
        }
      };

      recognition.onerror = (event) => {
        console.error('[LangLab] Speech recognition error:', event.error);
      };

      recognition.onend = () => {
        if (isRecording) {
          console.log('[LangLab] Speech recognition ended prematurely, restarting...');
          recognition.start();
        }
      };
    }
    
    async function startAudioRecording() {
      console.log('[LangLab] startAudioRecording called.');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        try {
          mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        } catch (e) {
          console.warn('Opus codec not supported, falling back to default.');
          mediaRecorder = new MediaRecorder(stream);
        }
        
        audioChunks = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };
        
        mediaRecorder.onstop = async () => {
          console.log('[LangLab] mediaRecorder.onstop triggered.');
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          await processAudioInput(audioBlob, currentTranscript);
          stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        if (recognition) {
          console.log('[LangLab] Starting live speech recognition.');
          currentTranscript = ''; // Reset transcript
          recognition.start();
        }
        isRecording = true;
        return true;
      } catch (error) {
        console.error('Error starting audio recording:', error);
        return false;
      }
    }
    
    function stopAudioRecording() {
      if (mediaRecorder && isRecording) {
        console.log('[LangLab] stopAudioRecording called, stopping mediaRecorder.');
        if (recognition) {
          recognition.stop();
        }
        mediaRecorder.stop();
        isRecording = false;
      }
    }
    
    async function processAudioInput(audioBlob, transcript) {
      console.log('[LangLab] processAudioInput called with blob size:', audioBlob.size, 'and transcript:', transcript);
      setControlsLoadingState(true, ["Listening...", "Analyzing...", "Preparing the response..."]);
      if (inputContainer) inputContainer.style.display = 'none';

      try {
        let result;
        try {
          console.log('[LangLab] Trying to send audio directly...');
          result = await sendAudioToTeacher(audioBlob);
          console.log('[LangLab] sendAudioToTeacher completed successfully.');

          // On success, display the audio player and clear the input
          displayRecordedAudio(audioBlob);
          if (input) input.value = '';

        } catch (audioError) {
          console.error('[LangLab] Error sending audio directly, falling back to transcript:', audioError);
          if (transcript) {
            console.log('[LangLab] Pivoting to send transcript.');
            
            // On fallback, display the transcript as a user message and clear the input
            renderResponseCard(targetEl, transcript, inputContainer);
            if (input) input.value = '';

            result = await sendTextToTeacher(transcript);
            console.log('[LangLab] sendTextToTeacher completed successfully.');

          } else {
            throw new Error('Audio sending failed and no transcript was available.');
          }
        }
        
        // Render the AI's response for either success path
        renderQuestionClickableBlock(targetEl, result, inputContainer);

      } catch (finalError) {
        console.error('[LangLab] Final processing error:', finalError);
        renderQuestionClickableBlock(targetEl, 'Sorry, I couldn\'t process your response. Please try again.', inputContainer);
      } finally {
        setControlsLoadingState(false);
        updateInputVisibility(targetEl);
        resetMicButton();
      }
    }
    
    
    function resetMicButton() {
      micBtn.disabled = false;
      input.disabled = false;
      input.placeholder = 'Type your answer…';
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
        marginBottom: '0px'
      });
      audio.controls = true;
      audio.src = URL.createObjectURL(audioBlob);
      
      audioContainer.appendChild(audio);
      
      // Insert before the input container
      targetEl.insertBefore(audioContainer, inputContainer);
      
      audioContainer._audioBlob = audioBlob;
      
      return audioContainer;
    }
    
    async function sendAudioToTeacher(audioBlob) {
      console.log('[LangLab] sendAudioToTeacher called.');
      const requestId = `weblang_teacher_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const isImageQuestion = targetEl.classList.contains(`${EXT_CLS_PREFIX}-image-question-container`);
      
      return new Promise((resolve, reject) => {
        const onResult = async (e) => {
          if (!e || !e.detail || e.detail.id !== requestId) return;
          window.removeEventListener('weblang-teacher-result', onResult, true);
          if (e.detail.ok) {
            const explanation = e.detail.result || '';
            const translatedResult = await translateQuestionToLearningLanguage(explanation);
            resolve(translatedResult);
          } else {
            reject(new Error(e.detail.error || 'Unknown error'));
          }
        };

        window.addEventListener('weblang-teacher-result', onResult, true);
        
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64Audio = reader.result;
          const detail = {
            id: requestId,
            type: 'answer',
            audio: base64Audio,
            lang: detectedLang,
            isImageQuestion
          };
          window.dispatchEvent(new CustomEvent('weblang-page-prompt', { detail }));
        };
        reader.onerror = (error) => {
          reject(error);
        };
        reader.readAsDataURL(audioBlob);
      });
    }

    async function transcribeAudioWithSpeechRecognition(audioBlob) {
      return new Promise(async (resolve, reject) => {
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        if (!recognition) {
          return reject('Speech Recognition API not supported.');
        }

        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          resolve(transcript);
        };

        recognition.onerror = (event) => {
          reject(`Speech recognition error: ${event.error}`);
        };
        
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioContext = new AudioContext();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          const streamDestination = audioContext.createMediaStreamDestination();
          source.connect(streamDestination);
          const stream = streamDestination.stream;
          
          // SpeechRecognition needs a MediaStreamTrack
          const audioTrack = stream.getAudioTracks()[0];
          const mediaStream = new MediaStream([audioTrack]);

          // This is a workaround since SpeechRecognition API doesn't directly accept a MediaStream
          const audio = new Audio();
          audio.srcObject = mediaStream;
          audio.play();

          recognition.start();

          source.onended = () => {
            setTimeout(() => {
              recognition.stop();
              audioContext.close();
            }, 1000);
          };
          source.start();
          
        } catch (error) {
          reject(`Error processing audio for transcription: ${error}`);
        }
      });
    }

    async function sendTextToTeacher(text) {
      console.log('[LangLab] sendTextToTeacher called with text:', text);
      const requestId = `weblang_teacher_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const isImageQuestion = targetEl.classList.contains(`${EXT_CLS_PREFIX}-image-question-container`);
      
      return new Promise((resolve, reject) => {
        const onResult = async (e) => {
          if (!e || !e.detail || e.detail.id !== requestId) return;
          window.removeEventListener('weblang-teacher-result', onResult, true);

          if (e.detail.ok) {
            const explanation = e.detail.result || '';
            const translatedResult = await translateQuestionToLearningLanguage(explanation);
            resolve(translatedResult);
          } else {
            reject(new Error(e.detail.error || 'Unknown error'));
          }
        };

        window.addEventListener('weblang-teacher-result', onResult, true);
        
        const detail = {
          id: requestId,
          type: 'answer',
          text,
          lang: detectedLang,
          isImageQuestion
        };
        window.dispatchEvent(new CustomEvent('weblang-page-prompt', { detail }));
      });
    }

    micBtn.addEventListener('click', async () => {
      if (isRecording) {
        console.log('[LangLab] Stop recording button clicked.');
        stopAudioRecording();
        return;
      }
      
      console.log('[LangLab] Start recording button clicked.');
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
      
      // Close translation block if it's visible
      if (isTranslationVisible) {
        hideTranslationBlock();
      }
      
      setControlsLoadingState(true, ['Evaluating...', 'Checking...', 'Almost there...']);
      if (inputContainer) inputContainer.style.display = 'none';
      
      const answerContainer = renderResponseCard(targetEl, txt, inputContainer);
      const isImageQuestion = targetEl.classList.contains(`${EXT_CLS_PREFIX}-image-question-container`);
      scrollToBottom(isImageQuestion ? targetEl.parentElement : targetEl);
      
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

            // Re-enable controls
            setControlsLoadingState(false);
            
            // Update input visibility based on conversation state
            updateInputVisibility(targetEl);
            input.value = '';
            if (inputContainer.style.display !== 'none') {
              input.focus();
            }
          } catch (err) {
            console.error('Error handling eval result:', err);
            setControlsLoadingState(false);
            updateInputVisibility(targetEl);
          } finally {
            setControlsLoadingState(false);
            updateInputVisibility(targetEl);
          }
        };
        window.addEventListener('weblang-eval-result', onEval, true);
        chrome.runtime && chrome.runtime.sendMessage({ type: 'WEBLANG_EVAL_REQUEST', id: requestId, question: questionText, answer: txt, context: contextText, history: conversationHistory });
      } catch (err) {
        console.error('Answer evaluation failed:', err);
        setControlsLoadingState(false);
        updateInputVisibility(targetEl);
      }
    }
    // Translation functionality
    let translationBlock = null;
    let isTranslationVisible = false;
    
    translateBtn.addEventListener('click', () => {
      if (!isTranslationVisible) {
        showTranslationBlock();
      } else {
        hideTranslationBlock();
      }
    });

    function showTranslationBlock() {
      if (isTranslationVisible) return;
      isTranslationVisible = true;
      
      // Update button state with visual indicator
      translateBtn.style.background = '#1a73e8';
      translateBtn.style.color = '#ffffff';
      translateBtn.style.border = '2px solid #4285f4';
      translateBtn.style.boxShadow = '0 0 8px rgba(26, 115, 232, 0.4)';
      translateBtn.title = 'Hide translation';
      
      // Create translation block
      translationBlock = createElement('div', `${EXT_CLS_PREFIX}-translation-block`, {
        marginBottom: '8px',
        padding: '8px',
        background: 'rgba(31, 41, 55, 0.5)',
        border: '1px solid rgba(75, 85, 99, 0.2)',
        borderRadius: '6px',
        fontSize: '12px'
      });

      // Create header with close button
      const header = createElement('div', '', {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px'
      });

      const title = createElement('div', '', {
        fontSize: '12px',
        fontWeight: '600',
        color: '#e5e7eb'
      });
      title.textContent = 'Translate';

      const closeBtn = createElement('button', '', {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '2px',
        borderRadius: '3px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9ca3af'
      });
      closeBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/>
        </svg>
      `;

      // Create side-by-side layout
      const translationLayout = createElement('div', '', {
        display: 'flex',
        gap: '8px',
        alignItems: 'flex-start'
      });

      // Source language section
      const sourceSection = createElement('div', '', {
        flex: '1',
        display: 'flex',
        flexDirection: 'column'
      });

      const sourceLabel = createElement('div', '', {
        fontSize: '10px',
        color: '#9ca3af',
        marginBottom: '2px',
        textTransform: 'uppercase',
        fontWeight: '500'
      });

      const translationInput = createElement('input', '', {
        width: '100%',
        padding: '6px 8px',
        borderRadius: '4px',
        border: '1px solid rgba(75, 85, 99, 0.6)',
        background: 'rgba(31, 41, 55, 0.7)',
        color: '#e5e7eb',
        fontSize: '12px',
        boxSizing: 'border-box'
      });
      translationInput.type = 'text';
      translationInput.placeholder = 'Enter word...';

      // Target language section
      const targetSection = createElement('div', '', {
        flex: '1',
        display: 'flex',
        flexDirection: 'column'
      });

      const targetLabel = createElement('div', '', {
        fontSize: '10px',
        color: '#9ca3af',
        marginBottom: '2px',
        textTransform: 'uppercase',
        fontWeight: '500'
      });

      const resultContainer = createElement('div', '', {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 8px',
        background: 'rgba(37, 99, 235, 0.1)',
        border: '1px solid rgba(37, 99, 235, 0.3)',
        borderRadius: '4px',
        minHeight: '32px'
      });

      const resultText = createElement('div', '', {
        flex: '1',
        fontSize: '12px',
        color: '#9ca3af'
      });
      resultText.textContent = 'Translation will appear here';

      const copyBtn = createElement('button', '', {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '2px',
        borderRadius: '3px',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9ca3af'
      });
      copyBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" fill="currentColor"/>
        </svg>
      `;

      // Set language codes in labels
      async function setLanguageLabels() {
        try {
          const learningLang = await getLearningLanguage();
          const nativeLang = await getNativeLanguage();
          
          sourceLabel.textContent = nativeLang.toUpperCase();
          targetLabel.textContent = learningLang.toUpperCase();
        } catch (error) {
          console.error('Error setting language labels:', error);
          sourceLabel.textContent = 'EN';
          targetLabel.textContent = 'LEARN';
        }
      }

      // Set language labels
      setLanguageLabels();

      // Event handlers
      let isTranslating = false;
      let translateTimeout;

      async function performTranslation() {
        const text = translationInput.value.trim();
        if (!text || isTranslating) return;

        isTranslating = true;
        resultText.textContent = 'Translating...';
        resultText.style.color = '#9ca3af';

        try {
          // Get the learning language
          const learningLang = await getLearningLanguage();
          const nativeLang = await getNativeLanguage();
          
          // Translate from native language to learning language
          const translation = await translateTo(text, learningLang, nativeLang);
          
          resultText.textContent = translation;
          resultText.style.color = '#e5e7eb';
          copyBtn.style.display = 'flex';
          
          // Copy functionality
          copyBtn.onclick = () => {
            navigator.clipboard.writeText(translation).then(() => {
              const originalHTML = copyBtn.innerHTML;
              copyBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" fill="#34a853"/>
                </svg>
              `;
              setTimeout(() => {
                copyBtn.innerHTML = originalHTML;
              }, 2000);
            });
          };

        } catch (error) {
          console.error('Translation error:', error);
          resultText.textContent = 'Translation failed';
          resultText.style.color = '#d93025';
          copyBtn.style.display = 'none';
        } finally {
          isTranslating = false;
        }
      }

      // Auto-translate on input
      translationInput.addEventListener('input', () => {
        clearTimeout(translateTimeout);
        translateTimeout = setTimeout(() => {
          if (translationInput.value.trim()) {
            performTranslation();
          } else {
            resultText.textContent = 'Translation will appear here';
            resultText.style.color = '#9ca3af';
            copyBtn.style.display = 'none';
          }
        }, 500);
      });

      // Assemble translation block
      header.appendChild(title);
      header.appendChild(closeBtn);
      
      sourceSection.appendChild(sourceLabel);
      sourceSection.appendChild(translationInput);
      
      resultContainer.appendChild(resultText);
      resultContainer.appendChild(copyBtn);
      targetSection.appendChild(targetLabel);
      targetSection.appendChild(resultContainer);
      
      translationLayout.appendChild(sourceSection);
      translationLayout.appendChild(targetSection);
      
      translationBlock.appendChild(header);
      translationBlock.appendChild(translationLayout);
      
      // Insert after the input container
      targetEl.insertBefore(translationBlock, inputContainer.nextSibling);
      
      // Focus the input
      translationInput.focus();
      
      // Event handlers
      closeBtn.onclick = hideTranslationBlock;
    }

    function hideTranslationBlock() {
      if (translationBlock && translationBlock.parentNode) {
        translationBlock.parentNode.removeChild(translationBlock);
      }
      translationBlock = null;
      isTranslationVisible = false;

      translateBtn.style.background = 'rgba(31,41,55,0.7)';
      translateBtn.style.color = '#e5e7eb';
      translateBtn.style.border = '1px solid rgba(75, 85, 99, 0.8)';
      translateBtn.style.boxShadow = 'none';
      translateBtn.title = 'Translate a word';
    }

    // Proofreader functionality
    proofreaderBtn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) {
        alert('Please enter some text to check.');
        return;
      }

      try {
        // Check if Proofreader API is available
        if (typeof Proofreader === 'undefined') {
          alert('Proofreader API is not available in this browser. Please use Chrome 141+ with the origin trial enabled.');
          return;
        }

        // Check availability
        const availability = Proofreader.availability();
        if (availability === 'unavailable') {
          alert('Proofreader API is not available on this device.');
          return;
        }

        // Show loading state
        proofreaderBtn.disabled = true;
        proofreaderBtn.style.opacity = '0.5';
        proofreaderBtn.title = 'Checking...';

        let proofreader;
        
        // If downloadable, create proofreader with download monitoring
        if (availability === 'downloadable') {
          const learningLang = await getLearningLanguage();
          proofreader = await Proofreader.create({
            expectedInputLanguages: [learningLang],
            monitor(m) {
              m.addEventListener('downloadprogress', (e) => {
                proofreaderBtn.title = `Downloading ${Math.round(e.loaded * 100)}%...`;
              });
            }
          });
        } else {
          // If available, create proofreader directly
          const learningLang = await getLearningLanguage();
          proofreader = await Proofreader.create({
            expectedInputLanguages: [learningLang]
          });
        }

        // Perform proofreading
        const result = await proofreader.proofread(text);
        
        // Display results
        showProofreaderResults(result, text);

      } catch (error) {
        console.error('Proofreader error:', error);
        alert('Failed to check text. Please try again.');
      } finally {
        // Reset button state
        proofreaderBtn.disabled = false;
        proofreaderBtn.style.opacity = '1';
        proofreaderBtn.title = 'Check grammar and spelling';
      }
    });

    function showProofreaderResults(result, originalText) {
      // Create proofreader results modal
      const modal = createElement('div', '', {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '999999'
      });

      const modalContent = createElement('div', '', {
        background: 'rgba(31, 41, 55, 0.95)',
        border: '1px solid rgba(75, 85, 99, 0.8)',
        borderRadius: '12px',
        padding: '20px',
        minWidth: '400px',
        maxWidth: '600px',
        maxHeight: '80vh',
        overflow: 'auto',
        color: '#e5e7eb'
      });

      const header = createElement('div', '', {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      });

      const title = createElement('h3', '', {
        margin: '0',
        fontSize: '18px',
        fontWeight: '600'
      });
      title.textContent = 'Grammar & Spelling Check';

      const closeBtn = createElement('button', '', {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '4px',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9ca3af'
      });
      closeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/>
        </svg>
      `;

      const content = createElement('div', '', {
        marginBottom: '16px'
      });

      // Show corrected text
      const correctedSection = createElement('div', '', {
        marginBottom: '16px'
      });

      const correctedLabel = createElement('div', '', {
        fontSize: '14px',
        fontWeight: '600',
        marginBottom: '8px',
        color: '#e5e7eb'
      });
      correctedLabel.textContent = 'Corrected Text:';

      const correctedText = createElement('div', '', {
        padding: '12px',
        background: 'rgba(37, 99, 235, 0.1)',
        border: '1px solid rgba(37, 99, 235, 0.3)',
        borderRadius: '8px',
        fontSize: '14px',
        lineHeight: '1.5'
      });
      correctedText.textContent = result.corrected;

      // Show corrections if any
      if (result.corrections && result.corrections.length > 0) {
        const correctionsSection = createElement('div', '', {
          marginBottom: '16px'
        });

        const correctionsLabel = createElement('div', '', {
          fontSize: '14px',
          fontWeight: '600',
          marginBottom: '8px',
          color: '#e5e7eb'
        });
        correctionsLabel.textContent = `Found ${result.corrections.length} correction(s):`;

        const correctionsList = createElement('div', '', {
          maxHeight: '200px',
          overflow: 'auto'
        });

        result.corrections.forEach((correction, index) => {
          const correctionItem = createElement('div', '', {
            padding: '8px',
            marginBottom: '8px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            fontSize: '12px'
          });

          const originalText = originalText.substring(correction.startIndex, correction.endIndex);
          const correctedText = correction.correction;

          correctionItem.innerHTML = `
            <div style="margin-bottom: 4px;">
              <strong>Error:</strong> "${originalText}"
            </div>
            <div style="margin-bottom: 4px;">
              <strong>Correction:</strong> "${correctedText}"
            </div>
            ${correction.explanation ? `<div><strong>Explanation:</strong> ${correction.explanation}</div>` : ''}
          `;

          correctionsList.appendChild(correctionItem);
        });

        correctionsSection.appendChild(correctionsLabel);
        correctionsSection.appendChild(correctionsList);
        content.appendChild(correctionsSection);
      } else {
        const noErrorsMsg = createElement('div', '', {
          padding: '12px',
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: '8px',
          fontSize: '14px',
          textAlign: 'center',
          color: '#22c55e'
        });
        noErrorsMsg.textContent = 'No errors found! Your text looks good.';
        content.appendChild(noErrorsMsg);
      }

      const buttonContainer = createElement('div', '', {
        display: 'flex',
        gap: '8px',
        justifyContent: 'flex-end'
      });

      const applyBtn = createButton('Apply Corrections', 'primary');
      const cancelBtn = createButton('Close', 'secondary');

      // Event handlers
      applyBtn.addEventListener('click', () => {
        input.value = result.corrected;
        document.body.removeChild(modal);
      });

      closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
      });

      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          document.body.removeChild(modal);
        }
      });

      // Assemble modal
      header.appendChild(title);
      header.appendChild(closeBtn);
      
      correctedSection.appendChild(correctedLabel);
      correctedSection.appendChild(correctedText);
      
      content.appendChild(correctedSection);
      
      buttonContainer.appendChild(applyBtn);
      buttonContainer.appendChild(cancelBtn);
      
      modalContent.appendChild(header);
      modalContent.appendChild(content);
      modalContent.appendChild(buttonContainer);
      modal.appendChild(modalContent);
      document.body.appendChild(modal);
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
  async function askQuestionWithPromptAPI(selectedText, existingQuestions = [], conversationHistory = [], mode = 'question', promptParams = {}) {
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
          history: conversationHistory,
          mode: mode,
          params: promptParams
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
      gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center',
      gap: '10px',
      marginTop: '10px',
      padding: '12px 0 0 0',
    });

    const leftControls = createElement('div');
    const btnNext = createButton('Next', 'secondary');
    applyStyles(btnNext, {
      height: '36px',
      boxSizing: 'border-box',
      padding: '0 12px',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      transition: 'transform 0.2s ease-in-out'
    });
    btnNext.innerHTML = `Next <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14m7-7-7 7-7-7"/></svg>`;
    btnNext.title = 'Next learnable item';
    btnNext.addEventListener('click', findAndActivateNextLearnableItem);
    btnNext.addEventListener('mouseenter', () => { btnNext.style.transform = 'translateY(-2px)'; });
    btnNext.addEventListener('mouseleave', () => { btnNext.style.transform = 'translateY(0)'; });
    leftControls.appendChild(btnNext);

    const mainControlsContainer = createElement('div', '', {
      position: 'relative',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '36px'
    });

    const centerWrap = createElement('div', `${EXT_CLS_PREFIX}-action-buttons`, {
      display: 'flex',
      justifyContent: 'center',
      gap: '8px'
    });

    const loadingIndicator = createElement('div', `${EXT_CLS_PREFIX}-loading-indicator`, {
      display: 'none',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: '#d1d5db'
    });
    const spinner = createElement('div', `${EXT_CLS_PREFIX}-spinner`);
    const loadingTextSpan = createElement('span');
    loadingIndicator.appendChild(spinner);
    loadingIndicator.appendChild(loadingTextSpan);

    const btnAsk = createButton('Ask me a question', 'primary');
    btnAsk.classList.add(`${EXT_CLS_PREFIX}-btn-ask`);
    applyStyles(btnAsk, { height: '36px', boxSizing: 'border-box', transition: 'transform 0.2s ease-in-out' });
    
    btnAsk.addEventListener('mouseenter', () => { btnAsk.style.transform = 'translateY(-2px)'; });
    btnAsk.addEventListener('mouseleave', () => { btnAsk.style.transform = 'translateY(0)'; });
    
    btnAsk.addEventListener('click', async () => {
      try {
        setControlsLoadingState(true, ['Reading...', 'Thinking...', 'Formulating question...']);
        if (context === 'image-popup') {
          const img = popupEl ? popupEl.querySelector('img') : null;
          if (img && popupBodyRef) {
            await generateImageQuestion(img, popupBodyRef);
          }
        } else if (context === 'popup') {
          if (popupBodyRef) {
            // Check if this is the first question or a follow-up
            const existingBlock = popupBodyRef.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
            if (existingBlock) {
              // It's a follow-up, add to existing conversation
              const conversation = Array.from(existingBlock.querySelectorAll('.conversation-turn')).map(turn => ({
                role: turn.dataset.role,
                content: turn.textContent
              }));
              await generateFollowUp(selectedText, popupBodyRef, conversation);
            } else {
              await generateInitialQuestion(selectedText, popupBodyRef);
            }
          }
        } else {
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
          const hasExistingContent = translationBodyEl.querySelector(`.${EXT_CLS_PREFIX}-question-block`);
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
      } catch (error) {
        console.error('Error handling "Ask me a question" click:', error);
        if (translationBodyEl) {
          translationBodyEl.textContent = 'Sorry, something went wrong.';
        }
      } finally {
        setControlsLoadingState(false);
      }
    });

    centerWrap.appendChild(btnAsk);

    if (context !== 'image-popup') {
      const btnExplain = createButton('Explain grammar', 'secondary');
      btnExplain.classList.add(`${EXT_CLS_PREFIX}-btn-explain`);
      applyStyles(btnExplain, { height: '36px', boxSizing: 'border-box', transition: 'transform 0.2s ease-in-out' });
      btnExplain.addEventListener('mouseenter', () => { btnExplain.style.transform = 'translateY(-2px)'; });
      btnExplain.addEventListener('mouseleave', () => { btnExplain.style.transform = 'translateY(0)'; });
      btnExplain.addEventListener('click', async () => {
        try {
          setControlsLoadingState(true, ['Analyzing...', 'Checking grammar...', 'Explaining...']);
          const nativeLang = await getNativeLanguage();
          const detectedLang = await detectLanguageCode(selectedText);
          const result = await askQuestionWithPromptAPI(selectedText, [], [], 'explain', { detectedLang, nativeLang });

          if (translationBodyEl) {
            const translatedResult = await translateTo(result, nativeLang, 'en');
            translationBodyEl.innerHTML = ''; // Clear previous content
            const responseEl = createElement('p', '', { color: '#f8fafc', fontSize: '18px' });
            responseEl.innerHTML = renderSimpleMarkdown(translatedResult || result);
            translationBodyEl.appendChild(responseEl);
          }
        } catch (error) {
          console.error('Error handling "Explain grammar" click:', error);
          if (translationBodyEl) {
            translationBodyEl.textContent = 'Sorry, something went wrong.';
          }
      } finally {
        setControlsLoadingState(false); 
      }
    });
      centerWrap.appendChild(btnExplain);
    }
    
    mainControlsContainer.appendChild(centerWrap);
    mainControlsContainer.appendChild(loadingIndicator);
    
    bar.appendChild(leftControls);
    bar.appendChild(mainControlsContainer);

    const rightControls = createElement('div');
    const vocabButtonText = pageVocabCount > 0 ? `📚 Vocab (${pageVocabCount})` : '📚 Vocab';
    const btnVocab = createButton(vocabButtonText, 'secondary');
    btnVocab.id = `${EXT_CLS_PREFIX}-vocab-btn`;
    applyStyles(btnVocab, { height: '36px', boxSizing: 'border-box', transition: 'transform 0.2s ease-in-out' });
    btnVocab.addEventListener('mouseenter', () => { btnVocab.style.transform = 'translateY(-2px)'; });
    btnVocab.addEventListener('mouseleave', () => { btnVocab.style.transform = 'translateY(0)'; });
    btnVocab.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'OPEN_POPUP_REQUEST' });
      } catch (error) {
        console.error('Failed to open popup:', error);
      }
    });
    rightControls.appendChild(btnVocab);
    bar.appendChild(rightControls);

    window.currentLanguageDetectionPromise = detectLanguageCode(selectedText);
    window.currentLanguageDetectionPromise.then(detectedLang => {
      currentDetectedLanguage = detectedLang;
    }).catch(err => {
      console.error('Language detection failed:', err);
      currentDetectedLanguage = 'unknown';
    });

    return bar;
  }

  let loadingIntervalId = null;
  function setControlsLoadingState(disabled, loadingTexts = []) {
    try {
      if (!popupEl) return;
      const buttonsContainer = popupEl.querySelector(`.${EXT_CLS_PREFIX}-action-buttons`);
      const loadingIndicator = popupEl.querySelector(`.${EXT_CLS_PREFIX}-loading-indicator`);

      if (!buttonsContainer || !loadingIndicator) {
        return;
      }

      if (loadingIntervalId) {
        clearInterval(loadingIntervalId);
        loadingIntervalId = null;
      }

      if (disabled) {
        buttonsContainer.style.display = 'none';
        loadingIndicator.style.display = 'flex';
        
        const textSpan = loadingIndicator.querySelector('span');
        if (textSpan) {
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
        }
      } else {
        buttonsContainer.style.display = 'flex';
        loadingIndicator.style.display = 'none';
      }
    } catch (e) {
      console.error('Error in setControlsLoadingState:', e);
      if (loadingIntervalId) {
        clearInterval(loadingIntervalId);
        loadingIntervalId = null;
      }
    }
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
    zIndex: '2147483647',
    minWidth: '600px'
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
      transform: position.transform,
      width: '600px',
      'max-height': '80vh',
      'display': 'flex',
      'flex-direction': 'column',
    };
    if (position.y) {
      imagePopupStyles.top = `${position.y}px`;
    }
    popupEl = createElement('div', `${EXT_CLS_PREFIX}-popup`, imagePopupStyles);
    
    addDragHandlersToPopup(popupEl);

    const closeBtn = createElement('button', '', {
      position: 'absolute',
      top: '12px',
      right: '12px',
      background: 'transparent',
      border: 'none',
      color: '#9ca3af',
      cursor: 'pointer',
      padding: '4px',
      zIndex: '10'
    });
    closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.onclick = () => closePopupWithAnimation();
    popupEl.appendChild(closeBtn);

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

    updateLearnedPercentage();

    return { bodyEl: body };
  }

  function createOverlayForText(rect, text, sourceParagraphEl) {
    clearPopup();
    const container = ensureContainer();
    ensureBackdrop();

    // Start language detection early
    window.currentLanguageDetectionPromise = detectLanguageCode(text);
    window.currentLanguageDetectionPromise.then(lang => {
      currentDetectedLanguage = lang;
    }).catch(err => {
      console.error('Language detection failed:', err);
      currentDetectedLanguage = 'unknown';
    });

    const minWidth = 600;
    const finalWidth = Math.max(rect.width, minWidth);
    let finalLeft = rect.left + (rect.width / 2) - (finalWidth / 2);

    const margin = 10;
    if (finalLeft < margin) {
      finalLeft = margin;
    }
    if (finalLeft + finalWidth > (window.innerWidth - margin)) {
      finalLeft = window.innerWidth - finalWidth - margin;
    }

    const textOverlayStyles = {
      ...POPUP_STYLES,
      left: `${finalLeft}px`,
      width: `${finalWidth}px`,
      overflow: 'hidden',
      'max-height': '80vh',
      'display': 'flex',
      'flex-direction': 'column',
    };
    popupEl = createElement('div', `${EXT_CLS_PREFIX}-overlay`, textOverlayStyles);

    addDragHandlersToPopup(popupEl);

    const closeBtn = createElement('button', '', {
      position: 'absolute',
      top: '12px',
      right: '12px',
      background: 'transparent',
      border: 'none',
      color: '#9ca3af',
      cursor: 'pointer',
      padding: '4px',
      zIndex: '10'
    });
    closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.onclick = () => closePopupWithAnimation();
    popupEl.appendChild(closeBtn);

    // Create scrollable content area
    const scrollableContent = createElement('div', '', {
      'overflow-y': 'auto',
      'flex-grow': '1',
      'display': 'flex',
      'flex-direction': 'column',
      'min-height': '0' // Important for flex scrolling
    });

    const wordsContainer = createElement('div', '', {
      lineHeight: '1.8',
      fontSize: '19px',
      color: '#e5e7eb',
      marginBottom: '8px',
      paddingTop: '20px',
      'flex-shrink': '0'
    });

    renderClickableWords(wordsContainer, text);
    overlayWordsContainerEl = wordsContainer;

    translationBodyEl = createElement('div', '', {
      fontSize: '18px',
      color: '#e5e7eb',
      marginTop: '8px',
      'flex-grow': '1'
    });

    // Add content to scrollable area
    scrollableContent.appendChild(wordsContainer);
    scrollableContent.appendChild(translationBodyEl);

    // Create fixed controls bar
    const controlsBar = buildControlsBar('overlay', text);
    applyStyles(controlsBar, {
      'flex-shrink': '0',
      'border-top': '1px solid #374151',
      'padding': '12px 0 0;',
      'margin': '0'
    });

    // Add to popup
    popupEl.appendChild(scrollableContent);
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

    updateLearnedPercentage();

    // Manage paragraph styles while overlay is open
    if (sourceParagraphEl) {
      activeParagraphEl = sourceParagraphEl;
      // Remove hover overlay and selected styling while active
      activeParagraphEl.classList.add(`${EXT_CLS_PREFIX}-selected`);
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
      @keyframes ${EXT_CLS_PREFIX}-gradient-pulse {
        0%, 100% { 
          opacity: 0.6;
          filter: brightness(1);
        }
        50% { 
          opacity: 0.8;
          filter: brightness(1.1);
        }
      }
      .${EXT_CLS_PREFIX}-teacher-explanation code {
        background-color: rgba(0,0,0,0.2);
        padding: 2px 5px;
        border-radius: 4px;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
        font-size: 13px;
      }
      .${EXT_CLS_PREFIX}-teacher-explanation pre {
        background-color: rgba(0,0,0,0.3);
        padding: 10px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 8px 0;
        font-size: 13px;
        white-space: pre-wrap;
      }
      .${EXT_CLS_PREFIX}-teacher-explanation pre code {
        padding: 0;
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  };

  async function openOverlayForElement(element, sourceParagraphEl, options = {}) {
    if (!element) {
      console.error('Element is undefined in openOverlayForElement');
      return;
    }
    
    const rect = element.getBoundingClientRect();
    
    if (!rect) {
      console.error('Failed to get bounding rect for element');
      return;
    }
    
    const text = element.innerText || element.textContent || '';
    createOverlayForText(rect, text, sourceParagraphEl || null);
  }

  function hasSubstantialText(element) {
    if (element.querySelector('img')) return false;
    const text = element.textContent || element.innerText || '';
    const cleanText = text.trim();
    if (cleanText.length < 50) return false;

    // Calculate link text density
    const linkElements = element.querySelectorAll('a');
    let linkTextLength = 0;
    linkElements.forEach(link => {
      linkTextLength += (link.textContent || '').trim().length;
    });

    if (linkTextLength > 0) {
        const nonLinkTextLength = cleanText.length - linkTextLength;
        // If the text is mostly links (e.g., a list of links, or one very long link)
        if (linkTextLength / cleanText.length > 0.8 || nonLinkTextLength < 25) {
            console.log('[LangLab] Skipping element due to high link density or low non-link text:', element);
            return false;
        }
    }

    // We can also check that it's not just a giant navigation block or something similar
    if (element.querySelectorAll('a').length > 5 && cleanText.length / element.querySelectorAll('a').length < 30) {
      return false;
    }
    return true;
  }

  function isElementInViewport(el) {
    if (el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
      rect.left < (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  function isClickInsideInteractiveElement(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"]');
  }

  function hasClickableParent(element) {
    let parent = element.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      if (parent.matches('a, button, [role="button"], [role="link"]')) {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  function isAllTextInInteractiveElements(element) {
    // Get all text nodes in the element
    const textNodes = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.trim()) {
        textNodes.push(node);
      }
    }
    
    // If no text nodes, return false (not all text in interactive elements)
    if (textNodes.length === 0) {
      return false;
    }
    
    // Check if all text nodes are inside interactive elements
    return textNodes.every(textNode => {
      const parent = textNode.parentElement;
      return parent && parent.closest('a, button, [role="button"], [role="link"], [contenteditable="true"]');
    });
  }

  async function handleParagraphClick(event) {
    if (isClickInsideInteractiveElement(event.target)) return;
    const selection = window.getSelection && window.getSelection();
    if (selection && selection.type === 'Range' && selection.toString().trim().length > 0) return;
    
    const paragraph = event.currentTarget;

    if (event.isTrusted) {
      paragraph.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    activeLearnableEl = paragraph;
    paragraph.classList.remove(`${EXT_CLS_PREFIX}-selected`);
    await openOverlayForElement(paragraph, paragraph);
  }

  function makeElementsClickable() {
    const blockElements = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt';
    const leafDivs = 'div:not(:has(p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, div, section, article, header, footer, aside, nav, ul, ol, table))';
    const leafSections = 'section:not(:has(p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, div, section, article, header, footer, aside, nav, ul, ol, table))';
    const leafArticles = 'article:not(:has(p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, div, section, article, header, footer, aside, nav, ul, ol, table))';
    const elements = document.querySelectorAll(`${blockElements}, ${leafDivs}, ${leafSections}, ${leafArticles}`);
    
    elements.forEach((p) => {
      if (p.tagName === 'IMG') return;
      // if (!isElementInViewport(p)) return;
      if (p.closest(`.${EXT_CLS_PREFIX}-container`)) return;
      if (clickableNodes.has(p) || p.closest(`.${EXT_CLS_PREFIX}-clickable`)) return;
      if (hasClickableParent(p)) return;
      if (!hasSubstantialText(p)) return;
      if (isAllTextInInteractiveElements(p)) return;
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
    spans.forEach((span) => {
      span.classList.add(`${EXT_CLS_PREFIX}-word-selected`);
      span.style.background = '#2563eb';
      span.style.color = '#fff';
      span.style.borderBottom = 'none';
      span.style.borderRadius = '4px';
    });
  }

  function renderClickableWords(container, text) {
    const state = {
      wordOrder: [],
      selectionStartIndex: null,
      isDragging: false,
      selectedWords: [],
      container: container
    };

    container.innerHTML = '';

    // Handle <br> tags by splitting on them and creating line breaks
    const textWithLineBreaks = String(text || '').replace(/<br\s*\/?>/gi, '\n');
    const parts = textWithLineBreaks.split(/(\s+)/);
    
    parts.forEach((part) => {
      if (part.trim() === '') {
        container.appendChild(document.createTextNode(part));
      } else if (part === '\n') {
        // Create a line break element
        const br = document.createElement('br');
        container.appendChild(br);
      } else {
        const cleanWord = part.replace(/[^\p{L}\p{N}'-]/gu, '').trim();
        const span = createElement('span', `${EXT_CLS_PREFIX}-word`, {
          cursor: 'pointer',
          transition: 'color 150ms ease-in-out, background 150ms ease-in-out, opacity 150ms ease-in-out',
          borderBottom: '1px dashed rgba(156,163,175,0.6)',
          display: 'inline-block',
          padding: '0 2px'
        });
        span.textContent = part;

        const currentIndex = state.wordOrder.length;
        if (cleanWord) {
          state.wordOrder.push({ word: cleanWord, span, index: currentIndex });
        }

        span.addEventListener('mouseenter', (e) => {
          if (state.isDragging) {
            e.preventDefault();
            e.stopPropagation();
            unmarkSelected();
            const start = state.selectionStartIndex;
            const end = currentIndex;
            const minIndex = Math.min(start, end);
            const maxIndex = Math.max(start, end);
            const sequential = state.wordOrder.slice(minIndex, maxIndex + 1);
            state.selectedWords = sequential.map((w) => w.word);
            markSelected(sequential.map((w) => w.span));
          } else {
            state.wordOrder.forEach((item) => {
              const distance = Math.abs(currentIndex - item.index);
              if (distance === 0) {
                item.span.style.opacity = '1';
              } else if (distance === 1) {
                item.span.style.opacity = '0.9';
              } else if (distance === 2) {
                item.span.style.opacity = '0.8';
              } else {
                item.span.style.opacity = '0.7';
              }
            });
          }
        });

        container.addEventListener('mouseleave', () => {
          state.wordOrder.forEach(item => {
            item.span.style.opacity = '1';
          });
        });

        span.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!cleanWord) return;
          
          // Reset opacity effect on selection start
          state.wordOrder.forEach(item => {
            item.span.style.opacity = '1';
          });

          unmarkSelected();
          
          state.isDragging = true;
          state.selectedWords = [cleanWord];
          state.selectionStartIndex = currentIndex;
          
          markSelected([span]);
          activeWordSelection = state;
        });

        container.appendChild(span);
      }
    });
  }

  // removed local translate; translation runs in service worker via translateTo

  async function getNativeLanguage() {
    try {
      if (!chrome.storage || !chrome.storage.local) return 'en';
      const conf = await new Promise((resolve) => chrome.storage.local.get(['weblangUserLang'], (r)=> resolve(r||{})));
      return conf && conf.weblangUserLang ? conf.weblangUserLang : 'en';
    } catch { 
      return 'en'; 
    }
  }

  function handleGlobalMouseUp() {
    if (activeWordSelection && activeWordSelection.isDragging) {
      const state = activeWordSelection;
      state.isDragging = false;
  
      // Update global selectedWords for other parts of the extension that rely on it
      selectedWords = state.selectedWords;
  
      if (selectedWords.length > 0) {
        const spans = state.container.querySelectorAll(`.${EXT_CLS_PREFIX}-word-selected`);
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
          (async () => {
            const nativeLang = await getNativeLanguage();
            const translation = await translateTo(selectedText, nativeLang, undefined, (msg)=>{ try { bodyEl.textContent = msg; } catch {} });
            if (!tipEl) return;
            setPopupTranslationResult(bodyEl, translation || 'Translation not available.');
          })();
        }
      }
      
      activeWordSelection = null;
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
      console.log('[LangLab] Text selection detected:', selectedText);
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

        // Exclude SVG elements and all nested nodes from selection
        const startElement = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
        const endElement = range.endContainer.nodeType === Node.TEXT_NODE ? range.endContainer.parentElement : range.endContainer;
        
        if (startElement?.closest('svg') || endElement?.closest('svg')) {
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
      closePopupWithAnimation();
    }
  }

  // Listen for language settings updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'RELOAD_LANGUAGE_SETTINGS') {
      console.log('Language settings updated, re-evaluating paragraphs...');
      // Clear existing clickable nodes and re-evaluate
      clickableNodes.clear();
      makeElementsClickable();
    }
    
    if (message.type === 'VOCAB_COUNT_UPDATED') {
      pageVocabCount = message.count;
      const vocabBtn = document.getElementById(`${EXT_CLS_PREFIX}-vocab-btn`);
      if (vocabBtn) {
        vocabBtn.textContent = pageVocabCount > 0 ? `📚 Vocab (${pageVocabCount})` : '📚 Vocab';
      }
    }
    
    if (message.type === 'ACTIVATE_AND_UPDATE') {
      activate();
      pageVocabCount = message.count;
      const vocabBtn = document.getElementById(`${EXT_CLS_PREFIX}-vocab-btn`);
      if (vocabBtn) {
        vocabBtn.textContent = pageVocabCount > 0 ? `📚 Vocab (${pageVocabCount})` : '📚 Vocab';
      }
    }

    if (message.type === 'DEACTIVATE') {
      deactivate();
    }
    
    if (message.type === 'ACTIVATE') {
      activate();
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

  function activate() {
    if (isActive) return;
    isActive = true;

    const styleId = `${EXT_CLS_PREFIX}-injected-styles`;
    if (!document.getElementById(styleId)) {
      const link = document.createElement('link');
      link.id = styleId;
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = chrome.runtime.getURL('styles.css');
      document.head.appendChild(link);
    }

    addClickableStyles();
    makeElementsClickable();
    attachImageClickHandlers();
    observer = new MutationObserver(() => {
      makeElementsClickable();
      attachImageClickHandlers();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('mouseup', handleGlobalMouseUp, true);
    document.addEventListener('mouseup', handlePageTextSelection, false);
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('resize', repositionPopup);
    console.log('[LangLab] Content script activated.');
  }

  function deactivate() {
    if (!isActive) return;
    isActive = false;
    // Hide all UI
    closePopupWithAnimation();
    clearTip();
    hideStartLearningWidget();
    pageVocabCount = 0;
  
    // Remove all event listeners and mutations observers
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    document.removeEventListener('mouseup', handleGlobalMouseUp, true);
    document.removeEventListener('mouseup', handlePageTextSelection, false);
    document.removeEventListener('mousedown', handleClickOutside, true);
    window.removeEventListener('resize', repositionPopup);
    
    // Remove clickable classes and event listeners
    document.querySelectorAll(`.${EXT_CLS_PREFIX}-clickable`).forEach(el => {
      el.classList.remove(`${EXT_CLS_PREFIX}-clickable`);
      // It's tricky to remove the exact event listener without a reference,
      // but since we check `isActive` now, they won't do anything.
    });
  
    console.log('[LangLab] Content script deactivated.');
  }

  async function findAndActivateNextLearnableItem() {
    console.log('[LangLab] Finding next learnable item...');
    
    let learnableItems = Array.from(document.querySelectorAll(`.${EXT_CLS_PREFIX}-clickable, .${EXT_CLS_PREFIX}-image-button-container`));
    
    learnableItems.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      if (rectA.top !== rectB.top) {
        return rectA.top - rectB.top;
      }
      return rectA.left - rectB.left;
    });

    if (learnableItems.length <= 1) {
      console.log('[LangLab] Not enough learnable items to navigate.');
      // Re-add class to the current item if it's the only one left
      if (activeLearnableEl) {
        activeLearnableEl.classList.add(`${EXT_CLS_PREFIX}-clickable`);
      }
      closePopupWithAnimation();
      return;
    }

    let activeIndex = -1;
    if (activeLearnableEl) {
      activeIndex = learnableItems.indexOf(activeLearnableEl);
    } else {
      // If no active element, check if an image popup is open
      const imgPopup = document.querySelector(`.${EXT_CLS_PREFIX}-popup img`);
      if (imgPopup) {
        const buttonContainer = imgPopup.closest(`.${EXT_CLS_PREFIX}-image-button-container`);
        if (buttonContainer) {
          activeIndex = learnableItems.indexOf(buttonContainer);
        }
      }
    }
    
    let nextItem;

    if (activeIndex === -1) {
      let currentY = window.scrollY;
      if (popupEl) {
        const rect = popupEl.getBoundingClientRect();
        currentY = rect.top + window.scrollY;
      }
      nextItem = learnableItems.find(item => {
        const itemRect = item.getBoundingClientRect();
        return (itemRect.top + window.scrollY) > (currentY + 5);
      });
      if (!nextItem) {
        nextItem = learnableItems[0];
      }
    } else {
      const nextIndex = (activeIndex + 1) % learnableItems.length;
      nextItem = learnableItems[nextIndex];
    }

    if (nextItem) {
      console.log('[LangLab] Next learnable item found:', nextItem);
      
      closePopupWithAnimation();

      setTimeout(() => {
        nextItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add a small delay for the click to ensure scrolling is complete
        setTimeout(() => {
          if (nextItem.classList.contains(`${EXT_CLS_PREFIX}-image-button-container`)) {
            const button = nextItem.querySelector('button');
            if (button) button.click();
          } else {
            nextItem.click();
          }
        }, 100);
      }, 300); // Wait for popup to close (250ms) + buffer
    }
  }

  function showStartLearningWidget() {
    const existingWidget = document.getElementById(`${EXT_CLS_PREFIX}-start-learning-widget`);
    if (existingWidget) return;

    const widget = createElement('div', '', {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483646',
      opacity: '0',
      transition: 'opacity 0.5s ease-in-out',
      borderRadius: '16px',
      padding: '2px',
      background: 'linear-gradient(90deg, #4f46e5, #c026d3, #db2777)',
      boxShadow: '0 8px 20px rgba(0,0,0,0.25)',
      transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out'
    }, { id: `${EXT_CLS_PREFIX}-start-learning-widget` });

    const button = createButton('', 'secondary');
    button.innerHTML = '🚀 Start learning in LangLab';
    applyStyles(button, {
      border: 'none',
      height: '44px',
      boxSizing: 'border-box',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      fontSize: '15px',
      borderRadius: '14px'
    });
    
    // Add hover effects
    widget.addEventListener('mouseenter', () => {
      widget.style.transform = 'translateX(-50%) translateY(-3px)';
      widget.style.boxShadow = '0 12px 24px rgba(0,0,0,0.3)';
    });
    widget.addEventListener('mouseleave', () => {
      widget.style.transform = 'translateX(-50%)';
      widget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.25)';
    });
    
    button.addEventListener('click', () => {
      const firstLearnable = document.querySelector(`.${EXT_CLS_PREFIX}-clickable, .${EXT_CLS_PREFIX}-image-button-container`);
      if (firstLearnable) {
        firstLearnable.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          if (firstLearnable.classList.contains(`${EXT_CLS_PREFIX}-image-button-container`)) {
            const btn = firstLearnable.querySelector('button');
            if (btn) btn.click();
          } else {
            firstLearnable.click();
          }
          hideStartLearningWidget();
        }, 500);
      }
    });

    widget.appendChild(button);
    document.body.appendChild(widget);

    setTimeout(() => {
      widget.style.opacity = '1';
    }, 100);
  }

  function hideStartLearningWidget() {
    const widget = document.getElementById(`${EXT_CLS_PREFIX}-start-learning-widget`);
    if (widget) {
      widget.style.opacity = '0';
      setTimeout(() => {
        if (widget.parentNode) {
          widget.parentNode.removeChild(widget);
        }
      }, 500);
    }
  }

  // Override the click handler to hide the widget on first interaction
  const originalHandleParagraphClick = handleParagraphClick;
  handleParagraphClick = function(...args) {
    hideStartLearningWidget();
    return originalHandleParagraphClick.apply(this, args);
  };

  const originalAskQuestionAboutImage = askQuestionAboutImage;
  askQuestionAboutImage = function(...args) {
    hideStartLearningWidget();
    return originalAskQuestionAboutImage.apply(this, args);
  };
  
  // Initialize and show the widget if learnable items are found
  setTimeout(() => {
    makeElementsClickable();
    attachImageClickHandlers();
    const clickableTextElements = document.querySelectorAll(`.${EXT_CLS_PREFIX}-clickable`);
    if (clickableTextElements.length >= 5) {
      showStartLearningWidget();
    }
  }, 500);

  // Load initial vocab count for the page
  (async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_VOCAB_COUNT_FOR_URL',
        url: window.location.href
      });
      if (response && response.success) {
        pageVocabCount = response.count;
      }
    } catch (error) {
      console.error('Failed to get initial vocab count:', error);
    }
  })();

  function updateLearnedPercentage() {
    if (!popupEl || !activeLearnableEl) return;

    let learnableItems = Array.from(document.querySelectorAll(`.${EXT_CLS_PREFIX}-clickable, .${EXT_CLS_PREFIX}-image-button-container`));
    
    learnableItems.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      if (rectA.top !== rectB.top) {
        return rectA.top - rectB.top;
      }
      return rectA.left - rectB.left;
    });

    const totalItems = learnableItems.length;
    if (totalItems === 0) return;

    const currentIndex = learnableItems.indexOf(activeLearnableEl);
    if (currentIndex === -1) return;

    const percentage = Math.round(((currentIndex + 1) / totalItems) * 100);

    let percentageEl = popupEl.querySelector(`.${EXT_CLS_PREFIX}-percentage-indicator`);
    if (!percentageEl) {
      percentageEl = createElement('div', `${EXT_CLS_PREFIX}-percentage-indicator`, {
        position: 'absolute',
        top: '12px',
        left: '12px',
        width: '28px',
        height: '28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: '10'
      });
      percentageEl.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" style="transform: rotate(-90deg);">
          <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2"></circle>
          <circle class="progress-ring" cx="12" cy="12" r="10" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"></circle>
        </svg>
        <span style="position: absolute; color: #e5e7eb; font-size: 9px; font-weight: 500;"></span>
      `;
      popupEl.appendChild(percentageEl);
    }
    
    const textSpan = percentageEl.querySelector('span');
    textSpan.textContent = `${percentage}%`;

    const progressRing = percentageEl.querySelector('.progress-ring');
    const radius = progressRing.r.baseVal.value;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;

    progressRing.style.strokeDasharray = `${circumference} ${circumference}`;
    progressRing.style.strokeDashoffset = offset;
  }

  function repositionPopup() {
    if (!popupEl) return;

    if (activeParagraphEl) { // Text overlay
      const rect = activeParagraphEl.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;

      const minWidth = 600;
      const finalWidth = Math.max(rect.width, minWidth);
      let finalLeft = rect.left + (rect.width / 2) - (finalWidth / 2);

      const margin = 10;
      if (finalLeft < margin) {
        finalLeft = margin;
      }
      if (finalLeft + finalWidth > (window.innerWidth - margin)) {
        finalLeft = window.innerWidth - finalWidth - margin;
      }

      popupEl.style.left = `${finalLeft}px`;
      popupEl.style.width = `${finalWidth}px`;
    } else if (popupEl.classList.contains(`${EXT_CLS_PREFIX}-popup`)) { // Image popup
      popupEl.style.left = `${window.innerWidth / 2}px`;
    }
  }

})();
