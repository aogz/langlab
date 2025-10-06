(() => {
  const urlDropdown = document.getElementById('urlDropdown');
  const wordsList = document.getElementById('wordsList');
  const emptyState = document.getElementById('emptyState');
  
  let savedWords = [];
  let currentFilter = 'all';
  let isRefreshing = false;
  let hasMigrated = false;
  
  // Practice mode variables
  let practiceWords = [];
  let currentQuestionIndex = 0;
  let correctAnswers = 0;
  let practiceMode = 'source-to-target'; // or 'target-to-source'

  // Initialize the sidebar
  async function init() {
    console.log('Initializing sidebar...');
    console.log('DOM elements:', { urlDropdown, wordsList, emptyState });
    
    if (!urlDropdown || !wordsList || !emptyState) {
      console.error('Required DOM elements not found');
      return;
    }
    
    await loadSavedWords();
    await loadSetupStatus();
    setupEventListeners();
    setupStorageListener();
    updateDisplay();
  }

  // Refresh words from storage (useful when sidebar reopens)
  async function refreshWords() {
    if (isRefreshing) {
      console.log('Already refreshing, skipping...');
      return;
    }
    
    isRefreshing = true;
    console.log('Refreshing words from storage...');
    await loadSavedWords();
    updateDisplay();
    isRefreshing = false;
  }

  // Load saved words from storage
  async function loadSavedWords() {
    try {
      const result = await chrome.storage.local.get(['langlabSavedWords']);
      console.log('Storage result:', result);
      savedWords = result.langlabSavedWords || [];
      
      // Also check if there are any words in the old storage format
      const allStorage = await chrome.storage.local.get();
      console.log('All storage keys:', Object.keys(allStorage));
      
      // Migrate words from old storage format if needed (only once)
      if (!hasMigrated) {
        await migrateOldWords(allStorage);
        hasMigrated = true;
      }
      
      updateUrlDropdown();
      console.log('Loaded saved words:', savedWords.length);
    } catch (error) {
      console.error('Error loading saved words:', error);
      savedWords = [];
    }
  }

  // Load setup status and display language preferences
  async function loadSetupStatus() {
    try {
      const result = await chrome.storage.local.get(['weblangUserLang', 'weblangLearnLang', 'weblangSetupCompleted']);
      const setupStatus = document.getElementById('setupStatus');
      const setupNativeLang = document.getElementById('setupNativeLang');
      const setupLearningLang = document.getElementById('setupLearningLang');
      
      if (result.weblangSetupCompleted && result.weblangUserLang && result.weblangLearnLang) {
        // Show setup status
        setupStatus.style.display = 'block';
        
        // Get language names from codes
        const nativeLangName = getLanguageName(result.weblangUserLang);
        const learningLangName = getLanguageName(result.weblangLearnLang);
        
        setupNativeLang.textContent = learningLangName;
        setupLearningLang.textContent = nativeLangName;
      } else {
        // Hide setup status if not completed
        setupStatus.style.display = 'none';
      }
    } catch (error) {
      console.error('Error loading setup status:', error);
    }
  }

  // Get language name from code
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

  // Open setup page for language configuration
  async function openSetup() {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('setup.html'),
        active: true
      });
    } catch (error) {
      console.error('Failed to open setup page:', error);
    }
  }

  // Setup storage change listener to update sidebar when settings change
  function setupStorageListener() {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
          // Check if language settings were updated
          if (changes.weblangUserLang || changes.weblangLearnLang || changes.weblangSetupCompleted) {
            console.log('Language settings updated, refreshing sidebar...');
            // Reload setup status to reflect new settings
            loadSetupStatus();
          }
          
          // Check if saved words were updated
          if (changes.langlabSavedWords) {
            console.log('Saved words updated, refreshing display...');
            refreshWords();
          }
        }
      });
    }
  }

  // Migrate words from old storage format
  async function migrateOldWords(allStorage) {
    const oldWords = [];
    
    // Look for old vocabulary storage keys
    Object.keys(allStorage).forEach(key => {
      if (key.startsWith('weblang_vocab_')) {
        const vocab = allStorage[key];
        if (Array.isArray(vocab)) {
          vocab.forEach(word => {
            if (word.word && word.url && word.translation) {
              // Check if this word already exists in savedWords
              const exists = savedWords.some(savedWord => 
                savedWord.word.toLowerCase() === word.word.toLowerCase() && 
                savedWord.url === word.url
              );
              
              if (!exists) {
                oldWords.push({
                  id: `${word.url}-${word.word}-${word.savedAt || Date.now()}-migrated`,
                  word: word.word,
                  translation: word.translation,
                  url: word.url,
                  title: word.url,
                  timestamp: word.savedAt || word.lastSaved || Date.now(),
                  domain: getDomainFromUrl(word.url),
                  correctAnswers: 0,
                  isKnown: false
                });
              }
            }
          });
        }
      }
    });

    if (oldWords.length > 0) {
      console.log('Found old words to migrate:', oldWords.length);
      savedWords.push(...oldWords);
      await saveWords();
      console.log('Migrated old words to new format');
    }
  }

  // Save words to storage
  async function saveWords() {
    try {
      await chrome.storage.local.set({ langlabSavedWords: savedWords });
    } catch (error) {
      console.error('Error saving words:', error);
    }
  }

  // Update URL dropdown with unique URLs
  function updateUrlDropdown() {
    const urls = [...new Set(savedWords.map(word => word.url))];
    const currentValue = urlDropdown.value;
    
    // Clear existing options except "All Pages"
    urlDropdown.innerHTML = '<option value="all">All Pages</option>';
    
    // Add URL options with full URLs
    urls.forEach(url => {
      const option = document.createElement('option');
      option.value = url;
      option.textContent = url; // Show full URL
      urlDropdown.appendChild(option);
    });
    
    // Restore selection if it still exists
    if (urls.includes(currentValue)) {
      urlDropdown.value = currentValue;
      currentFilter = currentValue;
    } else {
      urlDropdown.value = 'all';
      currentFilter = 'all';
    }
  }

  // Extract domain from URL
  function getDomainFromUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    urlDropdown.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      updateDisplay();
    });

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', refreshWords);

    // Clear all button
    const clearAllBtn = document.getElementById('clearAllBtn');
    clearAllBtn.addEventListener('click', clearAllWords);

    // Practice button
    const practiceBtn = document.getElementById('practiceBtn');
    practiceBtn.addEventListener('click', startPractice);

    // Setup change button
    const setupChangeBtn = document.getElementById('setupChangeBtn');
    if (setupChangeBtn) {
      setupChangeBtn.addEventListener('click', openSetup);
    }

    // Practice modal event listeners
    const practiceModal = document.getElementById('practiceModal');
    const practiceCloseBtn = document.getElementById('practiceCloseBtn');
    const closeResultBtn = document.getElementById('closeResultBtn');
    const restartBtn = document.getElementById('restartBtn');

    practiceCloseBtn.addEventListener('click', closePractice);
    closeResultBtn.addEventListener('click', closePractice);
    restartBtn.addEventListener('click', startPractice);

    // Listen for visibility changes to refresh when sidebar becomes visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('Sidebar became visible, refreshing words...');
        refreshWords();
      }
    });

    // Also listen for focus events as a backup
    window.addEventListener('focus', () => {
      console.log('Sidebar window focused, refreshing words...');
      refreshWords();
    });

    // Listen for storage changes to refresh when words are added from other tabs
    let storageChangeTimeout;
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.langlabSavedWords && !isRefreshing) {
        console.log('Storage changed, scheduling refresh...');
        // Debounce the refresh to prevent rapid successive calls
        clearTimeout(storageChangeTimeout);
        storageChangeTimeout = setTimeout(() => {
          refreshWords();
        }, 100);
      }
    });

  }



  // Update the main display
  function updateDisplay() {
    console.log('updateDisplay called - savedWords:', savedWords.length, 'currentFilter:', currentFilter);
    const filteredWords = currentFilter === 'all' 
      ? savedWords 
      : savedWords.filter(word => word.url === currentFilter);

    console.log('filteredWords:', filteredWords.length);

    if (filteredWords.length === 0) {
      showEmptyState();
      return;
    }

    hideEmptyState();
    renderWords(filteredWords);
  }

  // Show empty state
  function showEmptyState() {
    emptyState.style.display = 'block';
    wordsList.innerHTML = '';
  }

  // Hide empty state
  function hideEmptyState() {
    emptyState.style.display = 'none';
  }

  // Render words in a table grouped by URL
  function renderWords(words) {
    wordsList.innerHTML = '';
    
    if (words.length === 0) {
      showEmptyState();
      return;
    }

    // If filtering by specific URL, show simple table without URL headers
    if (currentFilter !== 'all') {
      renderSimpleTable(words);
      return;
    }

    // Group words by URL for "All" view
    const groupedWords = words.reduce((groups, word) => {
      if (!groups[word.url]) {
        groups[word.url] = {
          url: word.url,
          words: []
        };
      }
      groups[word.url].words.push(word);
      return groups;
    }, {});

    // Sort groups by most recent first
    const sortedGroups = Object.values(groupedWords).sort((a, b) => {
      const aLatest = Math.max(...a.words.map(w => w.timestamp));
      const bLatest = Math.max(...b.words.map(w => w.timestamp));
      return bLatest - aLatest;
    });

    // Render each group
    sortedGroups.forEach(group => {
      const groupEl = createUrlGroup(group);
      wordsList.appendChild(groupEl);
    });
  }

  // Render simple table without URL headers (for specific URL filter)
  function renderSimpleTable(words) {
    // Sort words by timestamp (newest first)
    const sortedWords = words.sort((a, b) => b.timestamp - a.timestamp);

    // Create table
    const table = document.createElement('table');
    table.className = 'words-table';
    
    // Create header
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Word</th>
        <th>Translation</th>
        <th>Language</th>
        <th>Progress</th>
        <th></th>
      </tr>
    `;
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');
    sortedWords.forEach(word => {
      const row = createWordRow(word);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    wordsList.appendChild(table);
  }

  // Create URL group element
  function createUrlGroup(group) {
    const groupEl = document.createElement('div');
    groupEl.className = 'url-group';
    groupEl.style.marginBottom = '24px';

    // URL header
    const headerEl = document.createElement('div');
    headerEl.style.cssText = `
      background: rgba(31,41,55,0.5);
      padding: 8px 12px;
      border-radius: 6px;
      margin-bottom: 8px;
      border-left: 3px solid #2563eb;
    `;
    headerEl.innerHTML = `
      <div style="color: #60a5fa; font-weight: 500; font-size: 13px;">${group.url}</div>
      <div style="color: rgba(229,231,235,0.6); font-size: 11px; margin-top: 2px;">${group.words.length} word${group.words.length !== 1 ? 's' : ''}</div>
    `;
    groupEl.appendChild(headerEl);

    // Create table for words
    const table = document.createElement('table');
    table.className = 'words-table';
    
    // Create header
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Word</th>
        <th>Translation</th>
        <th>Language</th>
        <th>Progress</th>
        <th></th>
      </tr>
    `;
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');
    // Sort words by timestamp (newest first)
    const sortedWords = group.words.sort((a, b) => b.timestamp - a.timestamp);
    sortedWords.forEach(word => {
      const row = createWordRow(word);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);

    groupEl.appendChild(table);
    return groupEl;
  }

  // Create word row element
  function createWordRow(word) {
    const row = document.createElement('tr');
    row.setAttribute('data-word-id', word.id);
    
    const language = word.sourceLanguage || 'unknown';
    const correctAnswers = word.correctAnswers || 0;
    const isKnown = word.isKnown || false;
    
    // Apply known styling
    if (isKnown) {
      row.style.opacity = '0.6';
      row.style.backgroundColor = 'rgba(34,197,94,0.05)';
    }
    
    // Create progress circle
    const progressPercentage = (correctAnswers / 7) * 100;
    const progressCircle = createProgressCircle(correctAnswers, isKnown, progressPercentage);
    
    row.innerHTML = `
      <td class="word-text">
        ${isKnown ? '✅ ' : ''}${word.word}
      </td>
      <td class="word-translation">${word.translation || 'Translation not available'}</td>
      <td class="word-language">${language}</td>
      <td class="word-progress">${progressCircle}</td>
      <td class="word-actions">
        <button class="remove-btn" data-word-id="${word.id}">Remove</button>
      </td>
    `;

    // Add click listener for remove button
    const removeBtn = row.querySelector('.remove-btn');
    removeBtn.addEventListener('click', () => removeWord(word.id));

    return row;
  }

  // Create progress circle element
  function createProgressCircle(correctAnswers, isKnown, progressPercentage) {
    if (isKnown) {
      return `
        <div class="progress-circle known">
          <div class="progress-text">✓</div>
        </div>
      `;
    }
    
    const degrees = (progressPercentage / 100) * 360;
    const circleStyle = `background: conic-gradient(#22c55e ${degrees}deg, rgba(31,41,55,0.6) ${degrees}deg);`;
    
    return `
      <div class="progress-circle" style="${circleStyle}">
        <div class="progress-text">${correctAnswers}</div>
      </div>
    `;
  }


  // Get time ago string
  function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  // Remove word from storage
  function removeWord(wordId) {
    savedWords = savedWords.filter(word => word.id !== wordId);
    saveWords();
    updateUrlDropdown();
    updateDisplay();
  }

  // Clear all words
  function clearAllWords() {
    if (confirm('Are you sure you want to clear all saved words?')) {
      savedWords = [];
      saveWords();
      updateUrlDropdown();
      updateDisplay();
    }
  }


  // Practice mode functions
  function startPractice() {
    const filteredWords = currentFilter === 'all' 
      ? savedWords 
      : savedWords.filter(word => word.url === currentFilter);

    if (filteredWords.length === 0) {
      alert('No words available for practice. Please save some words first.');
      return;
    }

    // Initialize practice session - prioritize unknown words
    const unknownWords = filteredWords.filter(word => !word.isKnown);
    const knownWords = filteredWords.filter(word => word.isKnown);
    
    // Mix unknown words first, then known words
    practiceWords = [...unknownWords, ...knownWords];
    currentQuestionIndex = 0;
    correctAnswers = 0;
    practiceMode = Math.random() < 0.5 ? 'source-to-target' : 'target-to-source';

    // Show practice modal
    const practiceModal = document.getElementById('practiceModal');
    practiceModal.style.display = 'flex';

    // Start first question
    showQuestion();
  }

  function closePractice() {
    const practiceModal = document.getElementById('practiceModal');
    practiceModal.style.display = 'none';
    
    // Hide both question and result sections
    document.getElementById('practiceQuestion').style.display = 'none';
    document.getElementById('practiceResult').style.display = 'none';
  }

  function showQuestion() {
    if (currentQuestionIndex >= practiceWords.length) {
      showResults();
      return;
    }

    const currentWord = practiceWords[currentQuestionIndex];
    const questionEl = document.getElementById('practiceQuestion');
    const resultEl = document.getElementById('practiceResult');
    
    // Show question, hide result
    questionEl.style.display = 'block';
    resultEl.style.display = 'none';

    // Update progress
    updateProgress();

    // Generate question and options
    const { question, correctAnswer, options } = generateQuestion(currentWord);
    
    // Update question text
    document.getElementById('questionText').textContent = question;
    const correctAnswers = currentWord.correctAnswers || 0;
    const isKnown = currentWord.isKnown || false;
    const progressText = isKnown ? ' (Known!)' : ` (${correctAnswers}/7)`;
    
    document.getElementById('questionHint').textContent = practiceMode === 'source-to-target' 
      ? `What does "${currentWord.word}" mean?${progressText}` 
      : `What is the translation of "${currentWord.translation}"?${progressText}`;

    // Create options
    const optionsContainer = document.getElementById('practiceOptions');
    optionsContainer.innerHTML = '';
    
    options.forEach((option, index) => {
      const optionBtn = document.createElement('button');
      optionBtn.className = 'option-btn';
      optionBtn.textContent = option;
      optionBtn.addEventListener('click', () => selectAnswer(option, correctAnswer, optionBtn));
      optionsContainer.appendChild(optionBtn);
    });
  }

  function generateQuestion(word) {
    const isSourceToTarget = practiceMode === 'source-to-target';
    const correctAnswer = isSourceToTarget ? word.translation : word.word;
    const question = isSourceToTarget ? word.word : word.translation;

    // Get other words for wrong options
    const otherWords = practiceWords.filter(w => w !== word);
    const wrongOptions = [];
    
    // Get 3 random wrong options
    while (wrongOptions.length < 3 && wrongOptions.length < otherWords.length) {
      const randomWord = otherWords[Math.floor(Math.random() * otherWords.length)];
      const wrongOption = isSourceToTarget ? randomWord.translation : randomWord.word;
      
      if (wrongOption && wrongOption !== correctAnswer && !wrongOptions.includes(wrongOption)) {
        wrongOptions.push(wrongOption);
      }
    }

    // If we don't have enough wrong options, add some generic ones
    while (wrongOptions.length < 3) {
      const genericOptions = isSourceToTarget 
        ? ['Unknown', 'Not sure', 'Maybe', 'Possibly', 'Perhaps']
        : ['Unknown', 'Not sure', 'Maybe', 'Possibly', 'Perhaps'];
      
      const randomGeneric = genericOptions[Math.floor(Math.random() * genericOptions.length)];
      if (!wrongOptions.includes(randomGeneric)) {
        wrongOptions.push(randomGeneric);
      }
    }

    // Combine correct and wrong options and shuffle
    const allOptions = [correctAnswer, ...wrongOptions.slice(0, 3)];
    const shuffledOptions = allOptions.sort(() => Math.random() - 0.5);

    return {
      question,
      correctAnswer,
      options: shuffledOptions
    };
  }

  function selectAnswer(selectedAnswer, correctAnswer, buttonElement) {
    // Disable all options
    const allButtons = document.querySelectorAll('.option-btn');
    allButtons.forEach(btn => {
      btn.classList.add('disabled');
      btn.style.cursor = 'not-allowed';
    });

    // Mark correct/incorrect
    allButtons.forEach(btn => {
      if (btn.textContent === correctAnswer) {
        btn.classList.add('correct');
      } else if (btn.textContent === selectedAnswer && selectedAnswer !== correctAnswer) {
        btn.classList.add('incorrect');
      }
    });

    // Update score and word progress
    if (selectedAnswer === correctAnswer) {
      correctAnswers++;
      updateWordProgress(practiceWords[currentQuestionIndex], true);
    } else {
      updateWordProgress(practiceWords[currentQuestionIndex], false);
    }

    // Move to next question after a delay
    setTimeout(() => {
      currentQuestionIndex++;
      showQuestion();
    }, 2000);
  }

  function updateProgress() {
    const progress = ((currentQuestionIndex + 1) / practiceWords.length) * 100;
    document.getElementById('progressFill').style.width = `${progress}%`;
    document.getElementById('progressText').textContent = 
      `Question ${currentQuestionIndex + 1} of ${practiceWords.length}`;
  }

  function updateWordProgress(word, isCorrect) {
    // Find the word in savedWords and update its progress
    const wordIndex = savedWords.findIndex(w => w.id === word.id);
    if (wordIndex !== -1) {
      if (isCorrect) {
        savedWords[wordIndex].correctAnswers = (savedWords[wordIndex].correctAnswers || 0) + 1;
        
        // Mark as known if correct answers reach 7
        if (savedWords[wordIndex].correctAnswers >= 7) {
          savedWords[wordIndex].isKnown = true;
        }
      } else {
        // Reset progress on incorrect answer (optional - you might want to keep this)
        // savedWords[wordIndex].correctAnswers = Math.max(0, (savedWords[wordIndex].correctAnswers || 0) - 1);
      }
      
      // Save updated words to storage
      saveWords();
      
      // Update the display to reflect the new status
      updateDisplay();
    }
  }

  function showResults() {
    const questionEl = document.getElementById('practiceQuestion');
    const resultEl = document.getElementById('practiceResult');
    
    // Hide question, show result
    questionEl.style.display = 'none';
    resultEl.style.display = 'block';

    // Calculate score
    const percentage = Math.round((correctAnswers / practiceWords.length) * 100);
    const scoreText = document.getElementById('resultScore');
    const resultText = document.getElementById('resultText');

    scoreText.textContent = `${correctAnswers}/${practiceWords.length} (${percentage}%)`;
    
    if (percentage >= 80) {
      scoreText.style.color = '#22c55e';
      resultText.textContent = 'Excellent work! You\'re mastering these words!';
    } else if (percentage >= 60) {
      scoreText.style.color = '#f59e0b';
      resultText.textContent = 'Good job! Keep practicing to improve further.';
    } else {
      scoreText.style.color = '#ef4444';
      resultText.textContent = 'Keep practicing! Review the words and try again.';
    }
  }

  // Initialize when DOM is loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();