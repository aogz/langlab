// Open side panel and relay preferences

chrome.runtime.onInstalled.addListener(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender) return;
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
  // Sidebar functionality removed for now
});


