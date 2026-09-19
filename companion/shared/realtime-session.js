import { behaviorTool, instructions, sessionSettings } from './behavior.js';

// Both Node and Workers own this configuration; request JSON never supplies it.
export function realtimeSession(env, input, { manualInput = false } = {}) {
  return {
    type: 'realtime', model: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1',
    instructions: instructions(sessionSettings(input)), output_modalities: ['audio'], max_output_tokens: 512,
    audio: {
      input: { transcription: { model: 'gpt-4o-mini-transcribe', language: 'zh' }, turn_detection: manualInput ? null : { type: 'semantic_vad', eagerness: 'low', create_response: true, interrupt_response: true } },
      output: { voice: env.OPENAI_CUSTOM_VOICE_ID ? { id: env.OPENAI_CUSTOM_VOICE_ID } : env.OPENAI_REALTIME_VOICE || 'coral' },
    },
    tools: [behaviorTool], tool_choice: 'auto',
  };
}
