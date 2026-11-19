// background.js - Boss直聘自动拓客插件后台服务
// 负责代理跨域 LLM API 请求，绕开内容脚本的 CORS 限制

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'llmFetch') {
    const controller = new AbortController();
    // 识图请求带整屏截图 base64，DeepSeek 侧处理耗时高于纯文本，超时从 15s 放宽到 30s
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    fetch(request.url, { ...request.options, signal: controller.signal })
      .then(async (resp) => {
        clearTimeout(timeoutId);
        const text = await resp.text();
        if (!resp.ok) {
          sendResponse({ ok: false, status: resp.status, statusText: resp.statusText, text });
        } else {
          sendResponse({ ok: true, status: resp.status, statusText: resp.statusText, text });
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        sendResponse({ ok: false, error: err.name === 'AbortError' ? 'LLM 请求超时（30秒）' : (err.message || String(err)) });
      });
    return true; // 保持消息通道异步
  }

  if (request.action === 'captureVisibleTab') {
    chrome.tabs.captureVisibleTab({ format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  return false;
});
