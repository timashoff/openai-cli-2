export const INSTRUCTIONS = {
  LITERARY: {
    key: ['-l', ':l'],
    description: 'make a sentence more literary',
    instruction: 'Rewrite the following sentence in a modern literary style and simplify it',
  },
  GRAMMAR: {
    key: ['-g', ':g', 'gg'],
    description: 'check the grammar',
    instruction: 'check the grammar of the following and replace all mistakes and typos',
  },
  RUSSIAN: {
    key: ['rr', 'рр', 'ру'],
    description: 'translate into Russian',
    instruction: 'translate the following sentence into Russian',
  },
  ENGLISH: {
    key: ['ee', 'аа', 'aa'],
    description: 'translate into English',
    instruction: 'translate the following sentence into English',
  },
  CHINESE: {
    key: ['cc', 'сс', 'кк'],
    description: 'translate into Chinese',
    instruction:
      'Translate the following sentence into Chinese and provide the Pinyin transcription',
  },
  PINYIN: {
    key: ['пп', 'pp'],
    description: 'show the Pinyin transcription',
    instruction: 'Provide the Pinyin transcription of the following sentence',
  },
  TRANSCRIPTION: {
    key: ['tr', 'тр'],
    description: 'show the English transcription',
    instruction:
      'show the English transcription of the following sentence. The response should only contain the transcription',
  },
  CEFR: {
    key: ['-cefr', ':cefr'],
    description: 'show CEFR levels',
    instruction: 'correlate the following words with CEFR levels of difficulty',
  },
  SENTENCE: {
    key: [':s', 'ss'],
    description: 'create a simple sentence',
    instruction: 'create a simple sentence using the following words',
  },
  HSK: {
    key: ['hsk'],
    description: 'translate into Eng, Ru, Pinyin ',
    instruction: 'translate the following into English, Russian, and Pinyin',
  },
  HSK_SS: {
    key: ['ssc'],
    description: 'create a simple sentence in chinese, and translate it',
    instruction: 'create a sentence in Chinese and translate it into English, Russian, and Pinyin',
  }
}

export const SYS_INSTRUCTIONS = {
  EXIT: {
    key: ['exit', 'выход'],
    description: 'close the programm',
  },
  HELP: {
    key: ['hh', 'хх', 'help'],
    description: 'print help info',
  },
}

