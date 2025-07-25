export const INSTRUCTIONS = {
  GRAMMAR: {
    key: ['gg'],
    description: 'check the grammar',
    instruction:
      'check the grammar of the following and replace all mistakes and typos',
  },
  RUSSIAN: {
    key: ['rr', 'ru', 'ру', 'переведи'],
    description: 'translate into Russian',
    instruction:
      'translate the following text into Russian',
  },
  ENGLISH: {
    key: ['аа', 'aa'],
    description: 'translate into English',
    instruction:
      'please provide multiple English translations of the following, categorized as: 1. Standard (usual case) 2. Natural-sounding (idiomatic, how a native speaker might say it) 3. Formal 4. Informal (as used in messaging apps)',
  },
  CHINESE: {
    key: ['cc', 'сс'],
    description: 'translate into Chinese',
    instruction:
      'Translate the following text into Chinese',
  },
  PINYIN: {
    key: ['пп', 'pp'],
    description: 'show the Pinyin transcription',
    instruction:
      'Provide the Pinyin transcription of the following text',
  },
  TRANSCRIPTION: {
    key: ['tr'],
    description: 'show the English transcription',
    instruction:
      'show the English transcription of the following text. The response should only contain the transcription',
  },
  SENTENCE: {
    key: ['ss'],
    description: 'create a simple sentence',
    instruction:
      'create a simple sentence using the following words',
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
  CMD: {
    key: ['cmd', 'кмд'],
    description: 'manage custom commands',
  },
}
