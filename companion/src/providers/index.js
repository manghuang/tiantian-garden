import { DemoProvider } from './demo.js';
import { OpenAIProvider } from './openai.js';
import { RelayProvider } from './relay.js';
export function createProvider(id, options) {
  if (id === 'demo') return new DemoProvider(options);
  if (id === 'deepseek') return new RelayProvider({ ...options, providerId: id });
  if (id === 'openai') return options.config.realtimeTransport === 'websocket' ? new RelayProvider(options) : new OpenAIProvider(options);
  throw new Error(`不支持的语音服务：${id}`);
}
