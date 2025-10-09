(function () {
  async function handle(e) {
    const detail = e && e.detail || {};
    const id = detail.id;
    const text = String(detail.text || '');
    const mode = detail.mode || 'question';
    const existingQuestions = detail.existingQuestions || [];
    const history = detail.history || [];
    if (!id) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser. See docs: https://developer.chrome.com/docs/ai/prompt-api');
      const availability = await window.LanguageModel.availability({
        outputLanguage: 'en'
      });
      if (availability === 'unavailable') throw new Error('On-device model unavailable. Ensure hardware requirements and try after a user click. See: https://developer.chrome.com/docs/ai/prompt-api');
      const session = await window.LanguageModel.create({
        outputLanguage: 'en'
      });
      let prompt = window.WEBLANG_PROMPTS.question(text, existingQuestions, history);
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.postMessage({
        type: 'WEBLANG_PROMPT_RESULT',
        id,
        ok: true,
        result: out
      }, window.location.origin);
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.postMessage({
        type: 'WEBLANG_PROMPT_RESULT',
        id,
        ok: false,
        error: msg
      }, window.location.origin);
    }
  }
  window.addEventListener('weblang-prompt-request', handle, true);

  async function evalHandle(e) {
    const d = e && e.detail || {};
    const id = d.id;
    const question = String(d.question || '');
    const answer = String(d.answer || '');
    const ctx = String(d.context || '');
    const history = d.history || [];
    if (!id) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({
        outputLanguage: 'en'
      });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({
        outputLanguage: 'en'
      });
      const prompt = window.WEBLANG_PROMPTS.evaluate(ctx, question, answer, history);
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : 'No evaluation.';
      window.dispatchEvent(new CustomEvent('weblang-eval-result', {
        detail: {
          id,
          ok: true,
          result: out
        }
      }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-eval-result', {
        detail: {
          id,
          ok: false,
          error: msg
        }
      }));
    }
  }
  window.addEventListener('weblang-eval-request', evalHandle, true);

  async function audioHandle(e) {
    const d = e && e.detail || {};
    const id = d.id;
    const audioData = d.audioData;
    const language = d.language || 'en';
    if (!id || !audioData) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({
        outputLanguage: 'en'
      });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({
        outputLanguage: 'en'
      });

      // Create multimodal prompt with audio input
      const prompt = window.WEBLANG_PROMPTS.transcribe();
      prompt.parts[1].inlineData.data = audioData;

      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-audio-result', {
        detail: {
          id,
          ok: true,
          result: out
        }
      }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-audio-result', {
        detail: {
          id,
          ok: false,
          error: msg
        }
      }));
    }
  }
  window.addEventListener('weblang-audio-request', audioHandle, true);

  async function teacherHandle(e) {
    const d = e && e.detail || {};
    const id = d.id;
    const audioBlob = d.audioBlob;
    const language = d.language || 'en';
    if (!id || !audioBlob) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({
        outputLanguage: 'en'
      });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({
        outputLanguage: 'en',
        expectedInputs: [{
          type: "audio"
        }]
      });

      // Create multimodal prompt with audio input for teacher feedback
      const prompt = window.WEBLANG_PROMPTS.teacherFeedback(audioBlob);

      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-teacher-result', {
        detail: {
          id,
          ok: true,
          result: out
        }
      }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-teacher-result', {
        detail: {
          id,
          ok: false,
          error: msg
        }
      }));
    }
  }
  window.addEventListener('weblang-teacher-request', teacherHandle, true);

  async function imageHandle(e) {
    const d = e && e.detail || {};
    const id = d.id;
    const imageData = d.imageData;
    const mimeType = d.mimeType;
    const language = d.language || 'en';
    if (!id || !imageData) {
      return;
    };
    try {
      // Convert base64 to Blob if needed
      let imageBlob = imageData;
      if (typeof imageData === 'string') {
        const binaryString = atob(imageData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        imageBlob = new Blob([bytes], {
          type: mimeType || 'image/jpeg'
        });
      }

      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({
        outputLanguage: 'en'
      });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({
        outputLanguage: 'en',
        expectedInputs: [{
          type: "image"
        }]
      });

      // Create multimodal prompt with image input for question generation
      const prompt = window.WEBLANG_PROMPTS.imageQuestion(imageBlob);

      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-image-result', {
        detail: {
          id,
          ok: true,
          result: out
        }
      }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-image-result', {
        detail: {
          id,
          ok: false,
          error: msg
        }
      }));
    }
  }
  window.addEventListener('weblang-image-request', imageHandle, true);
})();


