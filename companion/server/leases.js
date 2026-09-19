import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Only provider call identifiers and deadlines are durable. No audio, transcripts,
// admission cookies, API keys or parent information are written to this journal.
export function leaseJournal(path) {
  if (!path) return { read: () => [], write: () => {} };
  const file = resolve(path);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  return {
    read() {
      if (!existsSync(file)) return [];
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.calls) || data.calls.length > 100) throw new Error('会话恢复文件格式无效，停止启动以免丢失待关闭会话');
      for (const e of data.calls) if (!/^[a-zA-Z0-9_-]{1,128}$/.test(e.id) || !/^[a-zA-Z0-9_-]{1,256}$/.test(e.callId) || !Number.isFinite(e.expiresAt)) throw new Error('会话恢复记录无效');
      return data.calls;
    },
    write(sessions) {
      const calls = [...sessions].map(([id, entry]) => ({ id, callId: entry.callId, expiresAt: entry.expiresAt }));
      writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, calls }), { mode: 0o600, flush: true });
      renameSync(`${file}.tmp`, file);
    },
  };
}
