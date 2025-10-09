(function () {
  if (window.WEBLANG_PROMPTS) return;

  window.WEBLANG_PROMPTS = {
    // For generating questions about a text
    question: (text, existingQuestions, history) => {
      const historyText = (history && history.length > 0)
          ? `Here is the conversation history so far:\n${history.map(item => `${item.role}: ${item.content}`).join('\n')}`
          : '';

      if (existingQuestions && existingQuestions.length > 0) {
        const system = `You are a helpful language teacher. Continue the conversation with the student.
${historyText}

Based on the history, ask one new, different question in English about the following text that hasn't been covered yet. If the student has been asked 3 or more questions, you can suggest they select another text block. Output only the question or suggestion, no preface or explanation.`;
        return `${system}\n\nSelected text:\n\n${text}`;
      } else {
        const system = `You are a helpful language teacher. Given a learner's selected text, ask one engaging question in English that tests comprehension of the text. Output only the question, no preface or explanation.`;
        return `${system}\n\nSelected text:\n\n${text}`;
      }
    },

    // For evaluating a student's answer
    evaluate: (context, question, answer, history) => {
      const historyText = (history && history.length > 0)
        ? `This is the conversation history (the last message is the user's latest answer):\n${history.map(item => `${item.role}: ${item.content}`).join('\n')}`
        : '';

      return `You are a friendly and encouraging language tutor. Your goal is to provide simple, clear, and concise feedback on a student's answer. Keep your response to 1-2 sentences.

${historyText}

Analyze the student's latest answer based on the provided context, question, and conversation history.

- If the answer is perfect, say something like "Exactly!" or "Great job!".
- If the answer is mostly correct, point out the small error and provide the correction.
- If the answer is incorrect, gently correct them and provide a better example.

Be encouraging and brief.

Context:
${context}

Question:
${question}

Student answer:
${answer}`;
    },
    
    // For audio transcription
    transcribe: () => ({
      text: `Transcribe the following audio to text. Return only the transcribed text, no additional commentary.`,
      parts: [{ text: `Transcribe the following audio to text. Return only the transcribed text, no additional commentary.` }, { inlineData: { mimeType: 'audio/webm', data: '' } }]
    }),

    // For teacher feedback on audio
    teacherFeedback: (audioBlob) => ([{
      role: "user",
      content: [{
        type: "text",
        value: "You are a helpful language teacher. The student has provided an audio answer. Please listen to the audio and provide constructive feedback on their pronunciation, grammar, and language usage. Be encouraging and specific about what they did well and what they can improve. Keep your response concise but helpful."
      }, {
        type: "audio",
        value: audioBlob
      }]
    }]),

    // For asking a question about an image
    imageQuestion: (imageBlob) => ([{
      role: "user",
      content: [{
        type: "text",
        value: "You are a helpful language teacher. Look at this image and ask one engaging question in English that tests the student's ability to describe, analyze, or discuss what they see in the image. The question should be appropriate for language learning and encourage detailed responses. Output only the question, no preface or explanation."
      }, {
        type: "image",
        value: imageBlob
      }]
    }])
  };
})();
