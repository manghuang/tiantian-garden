export function isMissingMicrophone(error) {
  return ['NotFoundError', 'DevicesNotFoundError'].includes(error?.name);
}

export function microphoneFallbackNotice() {
  return '没有找到麦克风，已切换为文字互动。请在下方打字；连接或启用麦克风后刷新页面即可恢复语音。';
}

export function microphoneErrorMessage(error) {
  if (error?.name === 'NotAllowedError') return '麦克风没有获准使用，请允许麦克风或使用文字互动。';
  if (isMissingMicrophone(error)) return microphoneFallbackNotice();
  if (['NotReadableError', 'TrackStartError'].includes(error?.name)) return '麦克风正被其他程序占用，请关闭占用它的应用后重试。';
  if (error?.name === 'OverconstrainedError') return '当前麦克风不支持所需设置，请换一个麦克风后重试。';
  return error?.message || '麦克风连接失败，请重试。';
}
