export const INSTRUCTIONS = {
  LITERARY: {
    key: ['-l', ':l'],
    description: 'make a sentence more literary',
    instruction:
      'Rewrite the following sentence in a modern literary style and simplify it',
  },
  GRAMMAR: {
    key: ['gg'],
    description: 'check the grammar',
    instruction:
      'check the grammar of the following and replace all mistakes and typos',
  },
  RUSSIAN: {
    key: ['rr', 'ru', 'ру', 'переведи'],
    description: 'translate into Russian',
    instruction: 'translate the following text into Russian',
  },
  ENGLISH: {
    key: ['ee', 'аа', 'aa', 'translate'],
    description: 'translate into English',
    instruction: 'translate the following text into English',
  },
  CHINESE: {
    key: ['cc', 'сс'],
    description: 'translate into Chinese',
    instruction: 'Translate the following text into Chinese',
  },
  WEBPAGE: {
    key: ['summarize', 'суммируй'],
    description: 'summarize webpage content',
    instruction: 'Summarize the content from the provided webpage',
  },
  PINYIN: {
    key: ['пп', 'pp'],
    description: 'show the Pinyin transcription',
    instruction: 'Provide the Pinyin transcription of the following text',
  },
  TRANSCRIPTION: {
    key: ['tr'],
    description: 'show the English transcription',
    instruction:
      'show the English transcription of the following text. The response should only contain the transcription',
  },
  CEFR: {
    key: ['-cefr', ':cefr'],
    description: 'show CEFR levels',
    instruction: 'correlate the following words with CEFR levels of difficulty',
  },
  SENTENCE: {
    key: ['ss'],
    description: 'create a simple sentence',
    instruction: 'create a simple sentence using the following words',
  },
  HSK: {
    key: ['hsk'],
    description: 'translate into Eng, Ru, Pinyin',
    instruction:
      'translate the following into English, Russian, and provide the Pinyin transcription',
  },
  HSK_SS: {
    key: ['hskss'],
    description: 'create a simple sentence in chinese, and translate it',
    instruction:
      'create a sentence in Chinese using the following word or words, and translate it into English, Russian, and Pinyin',
  },
  CODE: {
    key: ['code'],
    description: 'check the code',
    instruction:
      'check the following code for errors and, in general, give your assessment of its quality',
  },
  WTF: {
    key: ['wtf', 'втф'],
    description: 'explain what this means?',
    instruction:
      'Can you explain what this means?',
  },
  URL: {
    key: ['url'],
    description: 'extract content from URL',
    instruction:
      'Extract and summarize content from the provided URL',
  },
}

export const SYS_INSTRUCTIONS = {
  EXIT: {
    key: ['exit', 'q'],
    description: 'close the programm',
  },
  HELP: {
    key: ['help'],
    description: 'print help info',
  },
  MODEL: {
    key: ['model'],
    description: 'choose the AI model',
  },
  PROVIDER: {
    key: ['provider'],
    description: 'change the API provider',
  },
}
