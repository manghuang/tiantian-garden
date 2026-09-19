// A protocol peer for actual workerd WebSocket tests; not a speech/model emulator.
export default {
  async fetch(request) {
    if (request.headers.get('Authorization') !== 'Bearer local-test-key') return new Response('Unauthorized', { status: 401 });
    const path = new URL(request.url).pathname;
    if (path === '/v1/moderations') {
      const body = await request.json();
      if (body.model !== 'omni-moderation-latest' || typeof body.input !== 'string') return new Response(null, { status: 400 });
      const flagged = body.input === '待拦截的测试回答';
      return Response.json({ results: [{ flagged, categories: Object.fromEntries(['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'].map(key => [key, flagged && key === 'illicit'])) }] });
    }
    if (path === '/chat/completions') {
      const body = await request.json();
      if (body.messages[0].role !== 'system' || !body.messages[0].content.includes('AI 小狗')) return new Response(null, { status: 400 });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: body.messages.at(-1).content === '审核拦截测试' ? '待拦截的测试回答' : '好呀，看我招招手！', action: 'wave', emotion: 'warm' }) } }] });
    }
    if (path === '/v1/audio/transcriptions') {
      const body = await request.formData();
      if (body.get('file')?.type !== 'audio/wav') return new Response(null, { status: 400 });
      return Response.json({ text: '测试 DeepSeek 语音输入' });
    }
    if (path === '/v1/audio/speech') {
      const body = await request.json();
      if (body.response_format !== 'pcm' || typeof body.input !== 'string' || body.input === '待拦截的测试回答') return new Response(null, { status: 400 });
      return new Response(new Uint8Array(4800), { headers: { 'Content-Type': 'audio/pcm' } });
    }
    const pair = new WebSocketPair(), socket = pair[1]; socket.accept();
    let number = 0, ready = false, text = '';
    const send = e => socket.send(JSON.stringify(e));
    const reply = (tools = true) => {
      const id = `response_${++number}`; send({ type: 'response.created', response: { id } });
      if (text === '招手' && tools) {
        send({ type: 'response.done', response: { id, status: 'completed', output: [{ type: 'function_call', call_id: `call_${number}`, name: 'perform_behavior', arguments: JSON.stringify({ action: 'wave', emotion: 'warm' }) }] } });
      } else {
        const item_id = `item_${number}`;
        const bytes = new Uint8Array(4800), view = new DataView(bytes.buffer);
        for (let i = 0; i < 2400; i++) view.setInt16(i * 2, Math.sin(i * 2 * Math.PI * 440 / 24000) * 600, true);
        send({ type: 'response.output_audio.delta', response_id: id, item_id, delta: btoa(String.fromCharCode(...bytes)) });
        send({ type: 'response.output_audio_transcript.done', response_id: id, item_id, transcript: text === '审核拦截测试' ? '待拦截的测试回答' : '你好，我在这里。' });
        send({ type: 'response.done', response: { id, status: 'completed', output: [] } });
      }
    };
    socket.addEventListener('message', ({ data }) => {
      const e = JSON.parse(data);
      if (e.type === 'session.update') {
        if (ready || !e.session.instructions.includes('AI 小狗') || e.session.audio.input.format.rate !== 24000) { send({ type: 'error', error: { code: 'invalid_config' } }); return; }
        ready = true; send({ type: 'session.updated', session: e.session });
      } else if (e.type === 'response.create') reply(e.response?.tool_choice !== 'none');
      else if (e.type === 'conversation.item.create' && e.item.role === 'user') text = e.item.content[0].text;
      else if (e.type === 'input_audio_buffer.append') {
        send({ type: 'input_audio_buffer.speech_started' }); send({ type: 'input_audio_buffer.speech_stopped' });
        send({ type: 'conversation.item.input_audio_transcription.completed', item_id: `input_${number}`, transcript: '测试语音输入' }); reply(false);
      }
    });
    return new Response(null, { status: 101, webSocket: pair[0] });
  },
};
