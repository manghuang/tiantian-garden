// The model and microphone are initialized only after admission succeeds.
export async function enterGarden() {
  const root = document.querySelector('#app');
  try {
    const response = await fetch('/api/auth');
    if (!response.ok) throw new Error();
    const access = await response.json();
    if (!access.authenticated) {
      root.innerHTML = `<main class="access-page"><form id="access-form" class="access-card"><p class="eyebrow">A LITTLE WORLD OF WONDER</p><h1>欢迎来到<br>天天的小花园</h1><p>请家长输入收到的访问口令，陪孩子一起开始。</p><label for="access-code">访问口令</label><input id="access-code" type="password" autocomplete="current-password" required maxlength="256"><p id="access-error" role="alert"></p><button class="primary-button" type="submit">进入小花园</button><p class="field-note">登录有效期为 8 小时。此处不会开启麦克风。</p></form></main>`;
      await new Promise(resolve => {
        const form = document.getElementById('access-form');
        const input = document.getElementById('access-code');
        const error = document.getElementById('access-error');
        const button = form.querySelector('button');
        input.focus();
        form.onsubmit = async event => {
          event.preventDefault(); button.disabled = true; error.textContent = '';
          try {
            const result = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: input.value }) });
            const data = await result.json();
            input.value = '';
            if (!result.ok) { error.textContent = data.error || '暂时无法登录，请重试。'; input.focus(); return; }
            resolve();
          } catch { error.textContent = '连接暂不可用，请检查网络后重试。'; }
          finally { button.disabled = false; }
        };
      });
    }
    const responseConfig = await fetch('/api/config');
    if (!responseConfig.ok) throw new Error();
    return await responseConfig.json();
  } catch {
    root.innerHTML = `<main class="access-page"><section class="access-card"><h1>花园暂时没有连接上</h1><p>请检查网络，稍后重新打开。</p><button class="primary-button" id="retry-access">重新连接</button></section></main>`;
    document.getElementById('retry-access').onclick = () => location.reload();
    // Stop initialization without unhandled rejections or loading protected assets.
    return new Promise(() => {});
  }
}
