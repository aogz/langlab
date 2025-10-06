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

  async function audioHandle(e){
    const d = e && e.detail || {}; const id = d.id; const audioData = d.audioData; const language = d.language || 'en';
    if (!id || !audioData) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({ outputLanguage: 'en' });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({ outputLanguage: 'en' });
      
      // Create multimodal prompt with audio input
      const prompt = {
        text: `Transcribe the following audio to text. Return only the transcribed text, no additional commentary.`,
        parts: [
          {
            text: `Transcribe the following audio to text. Return only the transcribed text, no additional commentary.`
          },
          {
            inlineData: {
              mimeType: 'audio/webm',
              data: audioData
            }
          }
        ]
      };
      
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-audio-result', { detail: { id, ok: true, result: out } }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-audio-result', { detail: { id, ok: false, error: msg } }));
    }
  }
  window.addEventListener('weblang-audio-request', audioHandle, true);

  async function teacherHandle(e){
    const d = e && e.detail || {}; const id = d.id; const audioBlob = d.audioBlob; const language = d.language || 'en';
    if (!id || !audioBlob) return;
    try {
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({ outputLanguage: 'en' });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({ 
        outputLanguage: 'en',
        expectedInputs: [
          { type: "audio" }
        ]
      });
      
      // Create multimodal prompt with audio input for teacher feedback
      const prompt = [{
        role: "user",
        content: [
          { 
            type: "text", 
            value: "You are a helpful language teacher. The student has provided an audio answer. Please listen to the audio and provide constructive feedback on their pronunciation, grammar, and language usage. Be encouraging and specific about what they did well and what they can improve. Keep your response concise but helpful." 
          },
          { 
            type: "audio", 
            value: audioBlob 
          }
        ]
      }];
      
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-teacher-result', { detail: { id, ok: true, result: out } }));
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'Unknown error';
      window.dispatchEvent(new CustomEvent('weblang-teacher-result', { detail: { id, ok: false, error: msg } }));
    }
  }
  window.addEventListener('weblang-teacher-request', teacherHandle, true);

  async function imageHandle(e){
    const d = e && e.detail || {}; const id = d.id; const imageData = d.imageData; const mimeType = d.mimeType; const language = d.language || 'en';
    console.log('Page-prompt received image request:', id, imageData);
    if (!id || !imageData) {
      console.log('No image data received');
      return;
    };
    try {
      console.log('Image data received:', imageData);
      console.log('Image data type:', typeof imageData);
      console.log('Image data constructor:', imageData.constructor.name);
      console.log('MIME type:', mimeType);
      console.log('Is string?', typeof imageData === 'string');
      console.log('Is object?', typeof imageData === 'object');
      
      // Convert base64 to Blob if needed
      let imageBlob = imageData;
      if (typeof imageData === 'string') {
        console.log('Converting base64 to Blob...');
        const binaryString = atob(imageData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        imageBlob = new Blob([bytes], { type: mimeType || 'image/jpeg' });
        console.log('Created blob:', imageBlob.size, 'bytes, type:', imageBlob.type);
      }
      
      if (imageBlob instanceof Blob) {
        console.log('Blob size:', imageBlob.size, 'type:', imageBlob.type);
      }
      
      if (!("LanguageModel" in window)) throw new Error('Prompt API not supported in this browser.');
      const availability = await window.LanguageModel.availability({ outputLanguage: 'en' });
      if (availability === 'unavailable') throw new Error('On-device model unavailable.');
      const session = await window.LanguageModel.create({ 
        outputLanguage: 'en',
        expectedInputs: [
          { type: "image" }
        ]
      });
      
      // Create multimodal prompt with image input for question generation
      const prompt = [{
        role: "user",
        content: [
          { 
            type: "text", 
            value: "You are a helpful language teacher. Look at this image and ask one engaging question in English that tests the student's ability to describe, analyze, or discuss what they see in the image. The question should be appropriate for language learning and encourage detailed responses. Output only the question, no preface or explanation." 
          },
          { 
            type: "image", 
            value: imageBlob 
          }
        ]
      }];
      
      console.log('Sending prompt to LanguageModel with image data');
      const result = await session.prompt(prompt);
      const out = (typeof result === 'string' && result.trim()) ? result.trim() : '';
      if (!out) throw new Error('Model returned an empty response.');
      window.dispatchEvent(new CustomEvent('weblang-image-result', { detail: { id, ok: true, result: out } }));
    } catch (e) {
      console.error('Error in imageHandle:', e);
      const msg = (e && e.message) ? e.message : 'Unknown error';
      console.error('Error message:', msg);
      window.dispatchEvent(new CustomEvent('weblang-image-result', { detail: { id, ok: false, error: msg } }));
    }
  }
  window.addEventListener('weblang-image-request', imageHandle, true);
})();


