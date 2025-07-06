
import { initializeApi } from './index.js';
import { validateApiKey, createSecureHeaders } from './security.js';
import { DEFAULT_MODELS } from '../config/default_models.js';
import { API_PROVIDERS } from '../config/api_providers.js';

export async function getModels(providerKey) {
  const provider = API_PROVIDERS[providerKey];
  if (!provider) {
    throw new Error(`Invalid provider key: ${providerKey}`);
  }

  if (provider.isClaude) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    validateApiKey(apiKey, 'anthropic');
    
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: createSecureHeaders(apiKey, 'anthropic')
    });
    const list = await response.json();
    if (!response.ok) {
      throw new Error(list.error.message);
    }
    return list.data.sort((a, b) => a.id.localeCompare(b.id));
  } else {
    const openai = initializeApi(providerKey);
    const list = await openai.models.list();
    return list.data.sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function findModel(defaultModels, models) {
  for (const defaultModel of defaultModels) {
    const currentModel = models.find((model) => model.id.includes(defaultModel));
    if (currentModel) {
      return currentModel.id;
    }
  }
  return models[0].id;
}

export async function createChatCompletion(providerKey, model, messages, signal) {
    const provider = API_PROVIDERS[providerKey];
    if (!provider) {
        throw new Error(`Invalid provider key: ${providerKey}`);
    }

    if (provider.isClaude) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        validateApiKey(apiKey, 'anthropic');
        
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: createSecureHeaders(apiKey, 'anthropic'),
            body: JSON.stringify({
                model,
                messages,
                stream: true,
                max_tokens: 4096
            }),
            signal
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error.message);
        }
        return response.body;
    } else {
        const openai = initializeApi(providerKey);
        return await openai.chat.completions.create(
            {
                model,
                messages,
                stream: true,
            },
            { signal },
        );
    }
}
