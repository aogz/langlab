(function(){
  async function handle(e){
    const detail = e && e.detail || {}; const id = detail.id; const text = String(detail.text||''); const mode = detail.mode || 'question'; const existingQuestions = detail.existingQuestions || [];
    if (!id) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser. See docs: https://developer.chrome.com/docs/ai/prompt-api');
      const availability = await window.LanguageModel.availability({ outputLanguage: 'en' });
      if (availability === 'unavailable') throw new Error('On-device model unavailable. Ensure hardware requirements and try after a user click. See: https://developer.chrome.com/docs/ai/prompt-api');
      const session = await window.LanguageModel.create({ outputLanguage: 'en' });
      let prompt;
      if (mode === 'grammar') {
        const sys = 'You are a helpful language teacher. Explain one key grammar point present in the learner\'s selected text, succinctly. Output 1-2 sentences in English.';
        prompt = sys + "\n\nSelected text:\n\n" + text;
      } else {
        if (existingQuestions && existingQuestions.length > 0) {
          const system = `You are a helpful language teacher. The student has already asked these questions about the text: ${existingQuestions.join(', ')}. 
          
          If the student has asked comprehensive questions about this text (3 or more), suggest they select another text block to continue learning. Otherwise, ask one new, different question in English about the following text that hasn't been covered yet. Output only the question or suggestion, no preface or explanation.`;
          prompt = system + "\n\nSelected text:\n\n" + text;
        } else {
          const system = 'You are a helpful language teacher. Given a learner\'s selected text, ask one engaging question in English that tests comprehension of the text. Output only the question, no preface or explanation.';
          prompt = system + "\n\nSelected text:\n\n" + text;
        }
      }
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-prompt-result', { detail: { id, ok: true, result: out } }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-prompt-result', { detail: { id, ok: false, error: msg } }));
    }
  }
  window.addEventListener('weblang-prompt-request', handle, true);

  async function evalHandle(e){
    const d = e && e.detail || {}; const id = d.id; const question = String(d.question||''); const answer = String(d.answer||''); const ctx = String(d.context||'');
    if (!id) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({ outputLanguage: 'en' });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({ outputLanguage: 'en' });
      const prompt = `You are a language teacher. Evaluate the student's short answer to the question based on the provided context. Output only a concise verdict in English with one of: Correct, Partially correct, Incorrect. Add a 1-sentence explanation or improvement.\n\nContext:\n${ctx}\n\nQuestion:\n${question}\n\nStudent answer:\n${answer}`;
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : 'No evaluation.';
      window.dispatchEvent(new CustomEvent('weblang-eval-result', { detail: { id, ok: true, result: out } }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-eval-result', { detail: { id, ok: false, error: msg } }));
    }
  }
  window.addEventListener('weblang-eval-request', evalHandle, true);
})();


