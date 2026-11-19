// content.js - Boss直聘自动拓客插件 v2.0.0
// AI 视觉主导版本：所有关键点击（职位导航、目标标签、沟通按钮）优先通过截图+AI坐标完成

(function() {
  'use strict';

  // ===== 防止重复注入 =====
  if (window.__bossAutoReplyLoaded) {
    console.log('[Boss拓客] 内容脚本已加载，跳过重复注入');
    return;
  }
  window.__bossAutoReplyLoaded = true;
  if (window.self !== window.top) return;

  const PLUGIN_VERSION = '2.0.42';

  // ===== 反自动化检测补丁 =====
  try {
    if (navigator.webdriver !== undefined) {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    }
  } catch (e) {}

  // ===== 默认配置 =====
  const DEFAULT_CONFIG = {
    targetCity: '杭州',
    targetTab: '国内电商运营（杭州）',
    searchKeyword: '电商运营杭州',
    salaryMin: 20,
    salaryMax: 100,
    dailyLimit: 150,
    intervalMin: 30,
    intervalMax: 90,
    workHoursOnly: false,
    greeting: "您好，看到贵司在招【岗位名】。我多年货架+内容电商经验，现主攻AI落地：搭自动化工作流、用AI员工承接重复性运营工作，辅以数据分析与复盘，实现人效提升与人力成本优化。成果见简历，方便可深聊。",
    llmApiKey: '',
    llmApiType: 'auto',
    llmBaseUrl: 'https://api.deepseek.com/v1',
    llmModel: 'deepseek-flash',
    llmThreshold: 70,
    useLlmScoring: true,
  };

  const STORAGE_KEY = 'bossAutoReplyConfig_v2';
  const STATE_KEY = 'bossAutoReplyState_v2';
  const LOG_KEY = 'bossAutoReplyLogs_v2';
  const SENT_KEY = 'bossAutoReplySent_v2';
  const RETURN_FLAG = 'bossAutoReplyReturn_v2';

  // ===== 城市代码映射（用于 URL 参数强制设置城市） =====
  const CITY_CODES = {
    '北京': '101010100', '上海': '101020100', '广州': '101280100',
    '深圳': '101280600', '杭州': '101210100', '成都': '101270100',
    '武汉': '101200100', '西安': '101110100', '南京': '101190100',
    '苏州': '101190400', '天津': '101030100', '重庆': '101040100',
    '长沙': '101250100', '郑州': '101180100', '青岛': '101120200',
    '厦门': '101230200', '宁波': '101210400', '合肥': '101220100'
  };

  // ===== 状态 =====
  let config = { ...DEFAULT_CONFIG };
  let isRunning = false;
  let shouldStop = false;
  let isStarting = false;
  let stats = { total: 0, success: 0, skipped: 0, failed: 0 };
  const MAX_LOGS = 500;
  const SENT_TTL_DAYS = 30;

  // ===== 工具函数 =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const randomBetween = (min, max) => Math.random() * (max - min) + min;
  const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });

  async function withRetry(fn, retries = 2, label = '操作') {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (i < retries) {
          log(`[重试] ${label} 第 ${i + 1} 次失败: ${e.message}`);
          await sleep(randomBetween(800, 1500));
        }
      }
    }
    throw lastErr || new Error(`${label} 失败`);
  }

  // ===== 日志系统 =====
  const _logs = [];
  async function initLogs() {
    try {
      const result = await chrome.storage.local.get(LOG_KEY);
      const saved = result[LOG_KEY];
      if (Array.isArray(saved)) _logs.push(...saved);
      while (_logs.length > MAX_LOGS) _logs.shift();
    } catch (e) {}
  }
  async function persistLogs() {
    try { await chrome.storage.local.set({ [LOG_KEY]: _logs.slice(-MAX_LOGS) }); } catch (e) {}
  }
  function log(msg) {
    const line = `[Boss拓客] ${msg}`;
    console.log(line);
    _logs.push({ time: now(), msg });
    if (_logs.length > MAX_LOGS) _logs.shift();
    persistLogs().catch(() => {});
    try { chrome.runtime.sendMessage({ action: 'log', msg }); } catch (e) {}
    try { updateFloatingLog(line); } catch (e) {}
  }
  function getLogs(limit = 100) { return _logs.slice(-limit); }

  // 页面内浮层日志，方便 F12 被禁用时查看
  function updateFloatingLog(line) {
    if (window.self !== window.top) return;
    let panel = document.getElementById('boss-auto-log-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'boss-auto-log-panel';
      panel.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;width:360px;max-height:240px;overflow-y:auto;background:rgba(0,0,0,0.75);color:#00ff9d;font-size:12px;font-family:monospace;padding:10px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);line-height:1.5;';
      const close = document.createElement('div');
      close.textContent = '×';
      close.style.cssText = 'position:absolute;right:6px;top:2px;cursor:pointer;color:#fff;font-size:14px;';
      close.addEventListener('click', () => panel.remove());
      panel.appendChild(close);
      document.body.appendChild(panel);
    }
    const entry = document.createElement('div');
    entry.textContent = `${now()} ${line}`;
    entry.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.1);padding:2px 0;';
    panel.appendChild(entry);
    while (panel.children.length > 12) panel.removeChild(panel.children[1]);
    panel.scrollTop = panel.scrollHeight;
  }

  // ===== 配置 / 状态 / 去重 =====
  // 配置迁移（__v2041 标记防重复）：v2.0.40 搜索词「电商运营总监杭州」+薪资下限 30K；
  // v2.0.41 职位来源改回「点击求职期望标签」优先（用户指定 2026-09-03），搜索直达降级为兜底。
  // v2.0.42（__v2042 标记）：薪资下限 30K→20K（用户指定 2026-09-09，20K 岗位也投递）。
  // v2.0.43（__v2043 标记）：大模型提供商由 Kimi 切到 DeepSeek（用户指定 2026-11-10），
  //   旧 Kimi/Moonshot 地址自动改为 DeepSeek，旧 sk-kimi- 密钥清空待重填。
  function migrateConfig(raw) {
    const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
    if (!cfg.__v2041) {
      cfg.searchKeyword = '电商运营杭州';
      cfg.salaryMin = 30;
      cfg.targetTab = '国内电商运营（杭州）';
      delete cfg.siteSalaryFilter;
      cfg.__v2041 = true;
    }
    if (!cfg.__v2042) {
      cfg.salaryMin = 20;
      cfg.__v2042 = true;
      try { chrome.storage.local.set({ [STORAGE_KEY]: cfg }); } catch (e) {}
      log('[配置] 已迁移 v2.0.42: 薪资下限=20K');
    }
    if (!cfg.__v2043) {
      if (/api\.kimi\.com|moonshot/.test(cfg.llmBaseUrl || '')) {
        cfg.llmBaseUrl = DEFAULT_CONFIG.llmBaseUrl;
        cfg.llmModel = DEFAULT_CONFIG.llmModel;
        cfg.llmApiKey = '';
      }
      cfg.__v2043 = true;
      try { chrome.storage.local.set({ [STORAGE_KEY]: cfg }); } catch (e) {}
      log(`[配置] 已迁移 v2.0.43: LLM=${cfg.llmBaseUrl} / ${cfg.llmModel}`);
    }
    return cfg;
  }

  async function loadConfig() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      config = migrateConfig(result[STORAGE_KEY]);
    } catch (e) { config = migrateConfig(null); }
  }

  const CROSS_TAB_STATE_KEY = 'bossAutoReplyCrossTabState_v2';
  const STATE_TTL_MS = 10 * 60 * 1000;

  function saveState(state) {
    try {
      const merged = { ...loadState(), ...state, ts: Date.now() };
      sessionStorage.setItem(STATE_KEY, JSON.stringify(merged));
      localStorage.setItem(CROSS_TAB_STATE_KEY, JSON.stringify(merged));
    } catch (e) {}
  }
  function loadState() {
    try {
      const s = sessionStorage.getItem(STATE_KEY);
      if (s) return JSON.parse(s);
      const ls = localStorage.getItem(CROSS_TAB_STATE_KEY);
      if (ls) {
        const obj = JSON.parse(ls);
        if (obj.ts && Date.now() - obj.ts < STATE_TTL_MS) return obj;
      }
    } catch (e) {}
    return {};
  }
  function clearState() {
    try {
      sessionStorage.removeItem(STATE_KEY);
      localStorage.removeItem(CROSS_TAB_STATE_KEY);
    } catch (e) {}
  }

  function getSentMap() {
    try { return JSON.parse(localStorage.getItem(SENT_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveSentMap(map) {
    try { localStorage.setItem(SENT_KEY, JSON.stringify(map)); } catch (e) {}
  }
  function cleanExpiredSent() {
    const map = getSentMap();
    const cutoff = Date.now() - SENT_TTL_DAYS * 24 * 60 * 60 * 1000;
    let changed = false;
    for (const k of Object.keys(map)) {
      if (map[k] < cutoff) { delete map[k]; changed = true; }
    }
    if (changed) saveSentMap(map);
  }
  function isDuplicate(jobId) {
    if (!jobId) return false;
    return !!getSentMap()[jobId];
  }
  function recordSent(jobId) {
    if (!jobId) return;
    const map = getSentMap();
    map[jobId] = Date.now();
    saveSentMap(map);
  }

  // ===== DOM 工具 =====
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
  }

  function simulateClick(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    } catch (e) {}
    try { el.focus(); } catch (e) {}
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = {
      bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
      clientX, clientY, screenX: clientX + (window.screenX || 0), screenY: clientY + (window.screenY || 0),
    };
    // 完整事件序列：mousemove → pointerdown → mousedown → pointerup → mouseup → click
    el.dispatchEvent(new MouseEvent('mousemove', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    try { el.click(); } catch (e) {}
    return true;
  }

  function clickAtCoordinates(x, y) {
    const target = document.elementFromPoint(x, y) || document.documentElement;
    const opts = {
      bubbles: true, cancelable: true, view: window, button: 0, buttons: 1,
      clientX: x, clientY: y,
      screenX: x + (window.screenX || 0), screenY: y + (window.screenY || 0),
    };
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));

    let node = target;
    for (let i = 0; i < 4 && node; i++) {
      const tag = node.tagName && node.tagName.toLowerCase();
      const role = node.getAttribute && node.getAttribute('role');
      if (tag === 'a' || tag === 'button' || role === 'button' || role === 'tab') {
        node.click();
        break;
      }
      node = node.parentElement;
    }
    return true;
  }

  // React 受控组件设值：绕过 value setter 拦截
  function setReactInputValue(input, value) {
    const tag = input.tagName.toLowerCase();
    let nativeSetter;
    if (tag === 'textarea') {
      nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    } else {
      nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    }
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isInputLike(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  function getInputText(el) {
    if (!el) return '';
    if (el.isContentEditable) return el.innerText || el.textContent || '';
    return el.value || el.textContent || '';
  }

  function dispatchEnter(el, ctrl = false) {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    if (ctrl) opts.ctrlKey = true;
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  async function fillInput(el, text) {
    if (!el) return false;
    try { el.focus(); el.click(); } catch (e) {}
    if (isInputLike(el)) {
      setReactInputValue(el, text);
    } else if (el.isContentEditable) {
      el.innerHTML = '';
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      try { sel.removeAllRanges(); sel.addRange(range); } catch (e) {}
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      } catch (e) {
        el.innerText = text;
      }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', code: 'End', keyCode: 35, which: 35, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'End', code: 'End', keyCode: 35, which: 35, bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  async function typeText(el, text) {
    if (!el) return false;
    try { el.focus(); el.click(); } catch (e) {}
    if (isInputLike(el)) {
      setReactInputValue(el, '');
      for (const ch of text) {
        const next = getInputText(el) + ch;
        setReactInputValue(el, next);
        await sleep(20 + Math.random() * 30);
      }
    } else if (el.isContentEditable) {
      el.innerHTML = '';
      for (const ch of text) {
        document.execCommand('insertText', false, ch);
        await sleep(20 + Math.random() * 30);
      }
    } else {
      el.textContent = '';
      for (const ch of text) {
        el.textContent += ch;
        await sleep(20 + Math.random() * 30);
      }
    }
    return true;
  }

  function findChatContainer() {
    const selectors = [
      '.chat-container',
      '.chat-box',
      '.message-container',
      '.chat-panel',
      '.chat-content',
      '.chat-main',
      '[class*="chat-container"]',
      '[class*="chat-box"]',
      '[class*="message-list"]',
      '[class*="chat-content"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isLikelyChatInput(el) {
    if (!el || !isVisible(el)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 20) return false;
    // 排除顶部搜索框（Boss 左侧联系人搜索）
    if (rect.bottom < window.innerHeight * 0.4) return false;
    const ph = (el.placeholder || el.getAttribute('placeholder') || '').toLowerCase();
    if (ph.includes('搜索') || ph.includes('search')) return false;
    if (el.closest('input[type="search"]')) return false;
    return true;
  }

  function findChatInput() {
    const selectors = [
      '.chat-input[contenteditable="true"]',
      '.chat-input [contenteditable="true"]',
      '.chat-editor[contenteditable="true"]',
      '.message-editor[contenteditable="true"]',
      '.editor[contenteditable="true"]',
      '[class*="chat-input"][contenteditable="true"]',
      '[class*="chat-editor"][contenteditable="true"]',
      '[class*="message-editor"][contenteditable="true"]',
      '[class*="editor"][contenteditable="true"]',
      '[contenteditable="true"]',
      '.chat-input',
      '.chat-editor',
      '.message-editor',
      '.editor',
      '.chat-input textarea',
      '.chat-input input',
      '.message-input textarea',
      '.message-input input',
      '.im-editor textarea',
      '.im-editor [contenteditable="true"]',
      'textarea[placeholder*="发送"]',
      'textarea[placeholder*="输入"]',
      '[contenteditable="true"][placeholder*="发送"]',
      '[contenteditable="true"][placeholder*="输入"]',
      'textarea',
      'input[type="text"]',
    ];

    const container = findChatContainer();
    const scope = container || document;

    for (const sel of selectors) {
      const nodes = Array.from(scope.querySelectorAll(sel));
      const input = nodes.find(n => isLikelyChatInput(n));
      if (input) {
        log(`[输入框] 选择器匹配: "${sel}", tag=${input.tagName}, class=${(input.className || '').toString().slice(0, 60)}, bottom=${Math.round(input.getBoundingClientRect().bottom)}`);
        return input;
      }
    }

    // 启发式兜底：遍历所有 contenteditable，按底部位置和相关父容器文本打分
    const allEditable = document.querySelectorAll('[contenteditable="true"]');
    let bestCandidate = null;
    let bestScore = -1;
    for (const el of allEditable) {
      if (!isLikelyChatInput(el)) continue;
      const rect = el.getBoundingClientRect();
      const parentText = (el.parentElement?.innerText || '').slice(0, 200).toLowerCase();
      let score = 0;
      if (rect.bottom > window.innerHeight * 0.6) score += 10;
      if (rect.bottom > window.innerHeight * 0.8) score += 5;
      if (/chat|message|editor|input|send|沟通|换行/.test(parentText)) score += 20;
      if (!el.closest('[class*="job-card"]') && !el.closest('[class*="job-list"]')) score += 10;
      if (rect.width > 100 && rect.height > 20) score += 5;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = el;
      }
    }
    if (bestCandidate) {
      log(`[输入框] 启发式匹配: tag=${bestCandidate.tagName}, class=${(bestCandidate.className || '').toString().slice(0, 60)}, score=${bestScore}`);
      return bestCandidate;
    }
    return null;
  }

  function isNegativeAction(text) {
    return /不感兴趣|举报|屏蔽|删除|收藏|分享|关注/.test(text);
  }

  function findChatButton(card) {
    const allBtns = document.querySelectorAll('button, a, [role="button"], [class*="btn"]');

    for (const btn of allBtns) {
      if (!isVisible(btn)) continue;
      const text = (btn.innerText || btn.textContent || '').trim();
      if (text.includes('立即沟通') && !isNegativeAction(text)) return btn;
    }

    for (const btn of allBtns) {
      if (!isVisible(btn)) continue;
      const text = (btn.innerText || btn.textContent || '').trim();
      if (text.includes('继续沟通') && !isNegativeAction(text)) return btn;
    }

    for (const btn of allBtns) {
      if (!isVisible(btn)) continue;
      const text = (btn.innerText || btn.textContent || '').trim();
      if (!text || isNegativeAction(text)) continue;
      if (text.includes('立即沟通') || text.includes('继续沟通') || text.includes('投递简历') || text.includes('发消息') || text.includes('聊一聊') || text.includes('打招呼')) return btn;
      const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
      const title = (btn.getAttribute('title') || '').trim();
      if (ariaLabel.includes('立即沟通') || ariaLabel.includes('继续沟通') || ariaLabel.includes('投递简历') || ariaLabel.includes('发消息') || ariaLabel.includes('聊一聊') || ariaLabel.includes('打招呼')) return btn;
      if (title.includes('立即沟通') || title.includes('继续沟通') || title.includes('投递简历') || title.includes('发消息') || title.includes('聊一聊') || title.includes('打招呼')) return btn;
    }

    const candidates = Array.from(allBtns).filter(b => isVisible(b)).filter(b => {
      const t = (b.innerText || b.textContent || '').trim();
      return /沟通|联系|投递|发消息|聊一聊|打招呼/.test(t);
    });
    if (candidates.length > 0) {
      log(`[调试] 找到 ${candidates.length} 个沟通相关候选按钮：` + candidates.slice(0, 5).map(b => `"${(b.innerText || '').trim().slice(0, 12)}"(${b.tagName}, ${Math.round(b.getBoundingClientRect().left)}, ${Math.round(b.getBoundingClientRect().top)})`).join(', '));
    }

    return null;
  }

  async function waitForChatInterface(timeout = 8000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (isChatPage()) return { type: 'page' };
      const input = findChatInput();
      if (input) return { type: 'panel', input };
      await sleep(500);
    }
    if (isChatPage()) return { type: 'page' };
    return null;
  }

  function getDetailPanelTitle() {
    const selectors = [
      '.job-detail-box .job-name',
      '.job-detail-box .job-title',
      '.job-detail-box h2',
      '.job-detail-header .name',
      '.job-detail-header h2',
      '.job-detail-section h2',
      '.job-detail-box [class*="job-name"]',
      '.job-detail-box [class*="title"]',
      '[class*="job-detail"] [class*="job-name"]',
      '[class*="job-detail"] h2',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.innerText || el.textContent || '').trim();
        if (text) return text;
      }
    }
    return '';
  }

  function getCardClickTarget(card) {
    return card.querySelector('a[href*="/job_detail/"]') ||
           card.querySelector('.job-name') ||
           card.querySelector('[class*="job-name"]') ||
           card.querySelector('a') ||
           card;
  }

  async function openJobDetail(card, info, timeout = 6000) {
    const target = getCardClickTarget(card);
    try { target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {}

    let lastTitle = '';
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      simulateClick(target);
      await sleep(1200);
      const detailTitle = getDetailPanelTitle();
      if (detailTitle) {
        if (detailTitle.includes(info.title) || info.title.includes(detailTitle)) {
          log(`[详情] 右侧详情已更新为: ${detailTitle}`);
          return true;
        }
        // 如果详情标题发生变化，也认为点击生效（即使不完全匹配，可能是截断/简化）
        if (lastTitle && lastTitle !== detailTitle) {
          log(`[详情] 右侧详情已切换: ${lastTitle} → ${detailTitle}`);
          return true;
        }
        lastTitle = detailTitle;
      }
      await sleep(800);
    }
    log(`[详情] 右侧详情未匹配目标岗位: ${info.title}，当前详情: ${getDetailPanelTitle()}`);
    return false;
  }

  function isSendButton(el) {
    if (!el || !isVisible(el)) return false;
    const t = (el.innerText || el.textContent || '').trim();
    const aria = (el.getAttribute('aria-label') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const cls = (el.className || '').toString().toLowerCase();

    if (/发送|send|submit|post/i.test(t) || /发送|send|submit|post/i.test(aria) || /发送|send|submit|post/i.test(title)) return true;
    if (/send|submit|post|btn-primary/.test(cls)) return true;

    const style = window.getComputedStyle(el);
    const bgColor = style.backgroundColor || '';
    const isGreen = /rgb\(\s*(0|1|2|3|4|5|6|7)\s*,\s*(1[5-9][0-9]|2[0-5][0-9])\s*,\s*(0|1|2|3|4|5|6|7)\s*\)/.test(bgColor) ||
                    /#0[0-9a-f][0-9a-f][0-9a-f]/.test(style.backgroundColor) ||
                    bgColor.includes('green');
    const rect = el.getBoundingClientRect();
    const isNearBottom = rect.top > window.innerHeight * 0.75;
    const isButtonLike = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || style.cursor === 'pointer' || cls.includes('btn');
    if (isGreen && isNearBottom && isButtonLike) return true;

    return false;
  }

  function scoreSendButtonLikelihood(el, inputEl) {
    let score = 0;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const cls = (el.className || '').toString().toLowerCase();
    const bgColor = style.backgroundColor || '';

    if (/rgb\(\s*0\s*,\s*(1[5-9][0-9]|2[0-5][0-9])\s*,\s*(0|1|2|3|4|5|6|7)\s*\)/.test(bgColor)) score += 5;
    if (/green|primary|send|submit/.test(cls)) score += 4;
    if (rect.top > window.innerHeight * 0.8) score += 3;
    if (rect.top > window.innerHeight * 0.7) score += 2;
    if (el.tagName === 'BUTTON') score += 3;
    if (el.getAttribute('role') === 'button') score += 2;
    if (style.cursor === 'pointer') score += 1;

    if (inputEl) {
      const inputRect = inputEl.getBoundingClientRect();
      const xDist = Math.abs((rect.left + rect.width / 2) - (inputRect.left + inputRect.width / 2));
      const yDist = Math.abs((rect.top + rect.height / 2) - (inputRect.top + inputRect.height / 2));
      if (xDist < 200 && yDist < 100) score += 3;
    }

    const text = (el.innerText || el.textContent || '').trim();
    if (isNegativeAction(text)) score -= 10;
    if (rect.width > 30 && rect.height > 20 && rect.width < 200 && rect.height < 100) score += 1;
    return score;
  }

  function findSendButton(inputEl) {
    const debug = [];

    const specificSelectors = [
      '.chat-input + button',
      '.chat-input ~ button',
      '.chat-input > button',
      '.chat-input [class*="send"]',
      '.chat-editor + button',
      '.chat-editor ~ button',
      '.message-editor + button',
      '.message-editor ~ button',
      '[class*="chat-input"] + button',
      '[class*="chat-input"] ~ button',
      '[class*="chat-editor"] + button',
      '[class*="chat-editor"] ~ button',
      '[class*="send"]',
      '[class*="submit"]',
      'button[type="submit"]',
    ];
    for (const sel of specificSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el) && isSendButton(el)) {
          log(`[发送按钮] 特定选择器匹配: "${sel}", tag=${el.tagName}, text="${(el.innerText || '').trim().slice(0, 12)}"`);
          return el;
        }
      } catch (e) {}
    }

    const container = findChatContainer();
    let scope = container || document;
    const allClickables = scope.querySelectorAll('button, [role="button"], div, span, a');
    for (const el of allClickables) {
      if (isSendButton(el)) {
        log(`[发送按钮] 容器内精确匹配: tag=${el.tagName}, text="${(el.innerText || '').trim().slice(0, 12)}"`);
        return el;
      }
    }
    debug.push(`容器内扫描 ${allClickables.length} 个，无精确匹配`);

    let p = inputEl ? inputEl.parentElement : null;
    let depth = 0;
    while (p && depth < 6) {
      const candidates = p.querySelectorAll('button, [role="button"], div, span, a');
      for (const el of candidates) {
        if (isSendButton(el)) {
          log(`[发送按钮] 父容器精确匹配(depth=${depth}): tag=${el.tagName}, text="${(el.innerText || '').trim().slice(0, 12)}"`);
          return el;
        }
      }
      debug.push(`父容器 depth=${depth} 扫描 ${candidates.length} 个，无精确匹配`);
      p = p.parentElement;
      depth++;
    }

    const globalClickables = document.querySelectorAll('button, [role="button"], div, span, a');
    let bestCandidate = null;
    let bestScore = -1;
    for (const el of globalClickables) {
      if (!isVisible(el)) continue;
      if (isSendButton(el)) {
        log(`[发送按钮] 全局精确匹配: tag=${el.tagName}, text="${(el.innerText || '').trim().slice(0, 12)}"`);
        return el;
      }
      const score = scoreSendButtonLikelihood(el, inputEl);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = el;
      }
    }
    debug.push(`全局扫描 ${globalClickables.length} 个，无精确匹配`);

    if (bestCandidate && bestScore >= 5) {
      log(`[发送按钮] 使用最高评分候选: score=${bestScore}, tag=${bestCandidate.tagName}, text="${(bestCandidate.innerText || '').trim().slice(0, 12)}"`);
      return bestCandidate;
    }

    log('[发送按钮] 未找到发送按钮: ' + debug.join('；'));
    return null;
  }

  // 在弹窗/聊天页内发送消息
  async function sendInChatPanel(panelInput, greeting) {
    const input = panelInput || findChatInput();
    if (!input) return { ok: false, reason: '未找到聊天输入框' };

    const tag = input.tagName.toLowerCase();
    const cls = (input.className || '').toString().split(' ').slice(0, 3).join('.');
    log(`[发送] 输入框 <${tag}${cls ? '.' + cls : ''}> editable=${input.isContentEditable} placeholder=${input.placeholder || input.getAttribute('placeholder') || '无'}`);

    function dispatchSendHotkey(target, ctrlKey = false) {
      const opts = {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 0,
        ctrlKey, bubbles: true, cancelable: true,
      };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keypress', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
      // Boss 可能监听 document/window
      document.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    function hasDraft() {
      const v = getInputText(input).trim();
      return v.length > 0 && v.length >= greeting.trim().length * 0.5;
    }

    async function trySubmit(label) {
      await sleep(500);
      dispatchSendHotkey(input);
      await sleep(1200);

      const btn = findSendButton(input);
      if (btn) {
        const btnText = (btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').trim();
        log(`[发送] ${label} 后点击发送按钮: "${btnText}"`);
        // 如果找到的是图标/span，优先点击最近的 button/role=button 祖先
        let clickTarget = btn;
        let node = btn;
        for (let i = 0; i < 4 && node; i++) {
          const tag = node.tagName && node.tagName.toLowerCase();
          const role = node.getAttribute && node.getAttribute('role');
          const style = window.getComputedStyle(node);
          if (tag === 'button' || tag === 'a' || role === 'button' || style.cursor === 'pointer') {
            clickTarget = node;
            break;
          }
          node = node.parentElement;
        }
        simulateClick(clickTarget);
        await sleep(1200);
      }

      if (!hasDraft()) return true;
      log(`[发送] ${label} 后输入框仍有: "${getInputText(input).trim().slice(0, 30)}"`);
      return false;
    }

    // 方法1：直接设值 / execCommand
    await fillInput(input, greeting);
    await sleep(600);
    const afterFill = getInputText(input).trim();
    log(`[发送] 填充后长度=${afterFill.length}, 期望=${greeting.trim().length}`);
    if (afterFill.length < greeting.trim().length * 0.5) {
      log('[发送] 填充后内容不足，尝试逐字输入');
      await typeText(input, greeting);
    }

    if (await trySubmit('fillInput')) {
      log('[发送] 已发送（fillInput + Enter/按钮）');
      return { ok: true };
    }

    // 方法2：重新逐字输入
    log('[发送] 尝试逐字输入');
    await typeText(input, greeting);
    if (await trySubmit('typeText')) {
      log('[发送] 已发送（逐字输入 + Enter/按钮）');
      return { ok: true };
    }

    // 方法3：Ctrl+Enter 兜底
    log('[发送] 尝试 Ctrl+Enter');
    dispatchSendHotkey(input, true);
    await sleep(1500);
    if (!hasDraft()) {
      log('[发送] 已发送（Ctrl+Enter）');
      return { ok: true };
    }

    // 方法4：聊天记录反查兜底
    const chatContainer = findChatContainer();
    const containerText = chatContainer ? (chatContainer.innerText || '').slice(0, 500) : '';
    if (containerText.includes(greeting.slice(0, 30))) {
      log('[发送] 已发送（聊天记录校验成功）');
      return { ok: true };
    }

    return { ok: false, reason: `发送后输入框仍有内容: "${getInputText(input).trim().slice(0, 30)}"` };
  }

  // ===== 薪资解析 =====
  function parseSalary(text) {
    if (!text) return [0, 0];
    let normalized = text
      .replace(/[\u200B\u200C\u200D\uFEFF\u2028\u2029\u2060\u00AD]/g, '')
      .replace(/[\uFF10-\uFF19]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/\uFF0D/g, '-');
    const m = normalized.match(/(\d+(?:\.\d+)?)\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[Kk千]/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    const m2 = normalized.match(/(\d+(?:\.\d+)?)\s*[Kk千]/);
    if (m2) return [parseFloat(m2[1]), parseFloat(m2[1])];

    const PUA_BASE = 0xE031;
    const puaToNum = ch => { const n = ch.charCodeAt(0) - PUA_BASE; return n >= 0 && n <= 9 ? n : -1; };
    const decodeChars = chars => {
      let val = 0;
      for (const c of chars) { const n = puaToNum(c); if (n < 0) return -1; val = val * 10 + n; }
      return val;
    };
    const rm = normalized.match(/([\uE000-\uF8FF]+)\s*[-~–—]\s*([\uE000-\uF8FF]+)\s*[Kk千]/);
    if (rm) {
      const a = decodeChars(rm[1]), b = decodeChars(rm[2]);
      if (a >= 0 && b >= 0) return [a, b];
    }
    const sm = normalized.match(/([\uE000-\uF8FF]+)\s*[Kk千]/);
    if (sm) { const a = decodeChars(sm[1]); if (a >= 0) return [a, a]; }
    return [0, 0];
  }
  // ===== 页面识别 =====
  function isJobListPage() {
    return /zhipin\.com\/(?:web\/geek\/job|web\/geek\/jobs|job\/|search\/)/.test(location.href) && !/\?sid=sem_/.test(location.href);
  }
  function isChatPage() { return /\/web\/geek\/chat/.test(location.href); }
  function isHomePage() { return /^https:\/\/www\.zhipin\.com\/?(?:\?.*)?$/.test(location.href); }

  // ===== 卡片提取 =====
  // v2.0.40：真实搜索页卡片根节点为 li.job-card-box（2026-09-03 深度自检实测 16 张 368x134）。
  // 旧选择器 .job-card-wrapper 在真实页面命中 0，导致卡片级薪资过滤失效（漏投低薪岗），故置顶真实选择器。
  function getJobCards() {
    const selectors = [
      'li.job-card-box',
      '.job-list-wrapper .job-card-wrapper',
      '.search-job-result .job-card-wrapper',
      '[class*="job-list"] [class*="job-card"]',
      '.job-card-wrapper',
    ];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      const valid = nodes.filter(n => {
        const rect = n.getBoundingClientRect();
        return rect.width > 150 && rect.width < 900 && rect.height > 50 && rect.height < 500;
      });
      if (valid.length > 0) return valid;
    }
    return [];
  }

  function extractCity(text) {
    if (!text) return '';
    // 优先匹配「城市·区·街道」格式
    const dotMatch = text.match(/([一-龥]{2,4})\s*·\s*([^\s·]+)/);
    if (dotMatch) return dotMatch[1].trim();

    // 兜底：从已知城市列表中匹配（只取第一个命中）
    const knownCities = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '苏州', '天津', '重庆', '长沙', '郑州', '青岛', '厦门', '宁波', '合肥', '无锡', '东莞', '佛山', '济南', '沈阳', '大连'];
    for (const city of knownCities) {
      if (text.includes(city)) return city;
    }
    return '';
  }

  function cleanJobTitle(raw) {
    if (!raw) return raw;
    return raw
      // Boss 反爬字体（PUA 码位）薪资，如 "□□-□□K·□□薪"
      .replace(/[-]+(?:\s*[-~–—]\s*[-]+)?\s*[Kk千](?:\s*·\s*[-]+\s*薪)?/g, ' ')
      // 普通数字薪资，如 "12-23K·13薪"
      .replace(/\d+(?:\.\d+)?\s*[-~–—]\s*\d+(?:\.\d+)?\s*[Kk千](?:\s*·\s*\d+\s*薪)?/g, ' ')
      .replace(/\d+(?:\.\d+)?\s*[Kk千](?:\s*·\s*\d+\s*薪)?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractCardInfo(card) {
    const text = (card.innerText || card.textContent || '');
    const titleEl = card.querySelector('.job-name, .job-title, [class*="job-name"], [class*="title"]');
    const title = (titleEl?.innerText || text.split('\n')[0] || '').trim();

    const salaryEl = card.querySelector('.salary, [class*="salary"]');
    const salary = (salaryEl?.innerText || '').trim();
    let [salaryMin, salaryMax] = parseSalary(salary);
    // v2.0.40 兜底：薪资元素未命中时从卡片全文解析（反爬字体下薪资仍在全文内，深度自检已验证两者解析一致）
    if (salaryMax <= 0) {
      const fb = parseSalary(text);
      if (fb[1] > 0) { salaryMin = fb[0]; salaryMax = fb[1]; }
    }

    // Boss 城市常见格式：杭州·余杭区·仓前，或单独一个 杭州
    const city = extractCity(text);

    // 检测「猎头」标签：多路策略
    // 1) 可见元素文本包含「猎头」（绿标可能在子元素或带空白）
    // 2) aria-label / title 属性含「猎头」
    // 3) 卡片全文前 300 字符兜底
    const allEls = Array.from(card.querySelectorAll('*'));
    const headhunterEls = allEls.filter(el => {
      if (!isVisible(el)) return false;
      const txt = (el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').trim();
      const tip = (el.getAttribute('title') || '').trim();
      return /猎头/.test(txt) || /猎头/.test(aria) || /猎头/.test(tip);
    });
    const isHeadhunter = headhunterEls.length > 0 || /猎头/.test(text.slice(0, 300));

    // 公司名称：优先精确选择器，再兜底从文本里找含「某」的行
    const companySelectors = [
      '.company-name',
      '.company-title',
      '[class*="company-name"]',
      '[class*="company-title"]',
      '[class*="company"]',
    ];
    let company = '';
    for (const sel of companySelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const t = (el.innerText || '').trim();
        if (t) { company = t; break; }
      }
    }
    // 兜底：从卡片文本行里找最像公司名的一行（通常较短、不含薪资、含「某」或「公司」）
    if (!company && text) {
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 2 && l.length <= 40);
      for (const line of lines) {
        if (/某/.test(line) || /公司/.test(line)) {
          // 排除明显不是公司的行
          if (/\d+[Kk千]/.test(line) || /经验/.test(line) || /学历/.test(line)) continue;
          company = line;
          break;
        }
      }
    }
    const isAnonymousCompany = /某/.test(company) || /某/.test(text);

    const linkEl = card.querySelector('a[href*="/job_detail/"]');
    const href = linkEl?.href || '';
    const jobId = href.match(/\/job_detail\/(\d+[^.\/?]*)/)?.[1] || `${title}_${salary}_${company}_${city}`;

    log(`[解析] 标题=${title} | 公司=${company} | 薪资=${salaryMin}-${salaryMax}K | 猎头=${isHeadhunter} | 匿名=${isAnonymousCompany}`);
    return { title, salary, salaryMin, salaryMax, city, company, isHeadhunter, isAnonymousCompany, href, jobId, element: card };
  }

  // 在卡片右上角叠加状态标签，让用户直观看到为什么没投
  function markCard(card, status, reason = '', customLabel = '') {
    if (!card || !card.style) return;
    const old = card.querySelector('.boss-auto-tag');
    if (old) old.remove();

    const tag = document.createElement('div');
    tag.className = 'boss-auto-tag';
    const colors = {
      pending: '#6B7B8C',
      city_mismatch: '#B89A7A',
      salary_low: '#B89A7A',
      salary_high: '#B89A7A',
      partner: '#B89A7A',
      jingdong: '#B89A7A',
      crossborder: '#B89A7A',
      design: '#B89A7A',
      entertainment: '#B89A7A',
      headhunter: '#B89A7A',
      business: '#B89A7A',
      anchor: '#B89A7A',
      intern: '#B89A7A',
      duplicate: '#B5ADA5',
      scoring: '#8FA3B8',
      score_pass: '#9AAE8A',
      score_low: '#B89A7A',
      chatting: '#9AAE8A',
      sent: '#00b38a',
      failed: '#ff4d4f',
    };
    const labels = {
      pending: '待处理',
      city_mismatch: '城市不符',
      salary_low: '薪资过低',
      salary_high: '薪资过高',
      partner: '合伙人不投',
      jingdong: '京东不投',
      crossborder: '跨境不投',
      design: '设计不投',
      entertainment: '娱乐不投',
      headhunter: '猎头不投',
      business: '商务不投',
      anchor: '主播不投',
      intern: '实习不投',
      duplicate: '已沟通过',
      scoring: '评分中',
      score_pass: '评分通过',
      score_low: '分数不足',
      chatting: '沟通中',
      sent: '已投递',
      failed: '投递失败',
    };
    const color = colors[status] || '#6B7B8C';
    tag.style.cssText = `position:absolute;right:8px;top:8px;z-index:9999;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${color};box-shadow:0 2px 6px rgba(0,0,0,0.2);pointer-events:none;max-width:220px;line-height:1.3;`;
    let displayText = customLabel || labels[status] || status;
    const reasonFirstStatuses = ['score_low', 'salary_low', 'salary_high', 'city_mismatch'];
    if (reasonFirstStatuses.includes(status) && reason) {
      displayText = reason.length > 28 ? reason.slice(0, 28) + '...' : reason;
    } else if (status === 'score_low' && reason) {
      displayText = reason.length > 28 ? reason.slice(0, 28) + '...' : reason;
    }
    tag.textContent = displayText;
    tag.title = reason || labels[status] || status;

    const pos = window.getComputedStyle(card).position;
    if (pos === 'static') card.style.position = 'relative';
    card.appendChild(tag);
  }

  function extractJobDescription() {
    const selectors = [
      '.job-detail-box .job-sec-text',
      '.job-sec-text',
      '.job-detail-section .text',
      '[class*="job-sec"] [class*="text"]',
      '[class*="job-detail"] [class*="text"]',
      '.job-description',
      '.describtion',
      '.position-desc',
      '.detail-content',
      '[class*="detail"] [class*="content"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 20) return el.innerText.trim();
    }
    return '';
  }

  // ===== LLM 调用 =====
  async function llmFetchViaBackground(url, options) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'llmFetch', url, options }, (result) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!result || !result.ok) {
          const detail = result?.status
            ? `HTTP ${result.status} ${result.statusText || ''}\n${(result.text || '').slice(0, 500)}`
            : (result?.error || 'LLM 请求失败');
          return reject(new Error(detail));
        }
        resolve(result.text);
      });
    });
  }

  function extractTextFromLLMResponse(text) {
    if (!text || !text.trim()) return '';
    let data;
    try { data = JSON.parse(text); } catch (e) { return text; }
    if (Array.isArray(data.content)) {
      const blocks = data.content.filter(b => b && (b.type === 'text' || b.type === 'thinking')).map(b => b.text || b.thinking).filter(Boolean);
      if (blocks.length) return blocks.join('\n');
    }
    if (typeof data.output === 'string') return data.output;
    if (typeof data.response === 'string') return data.response;
    if (typeof data.result === 'string') return data.result;
    if (typeof data.text === 'string') return data.text;
    if (typeof data.content === 'string') return data.content;
    return data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
  }

  // 从 LLM 返回的文本中提取第一个完整的 JSON 对象/数组，避免 "text {...} text" 导致解析失败
  function extractFirstJsonObject(text) {
    if (!text) return null;
    const start = text.search(/[\{\[]/);
    if (start === -1) return null;
    const open = text[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  async function callLLM(prompt, imageDataUrl) {
    const apiKey = (config.llmApiKey || '').trim();
    let baseUrl = (config.llmBaseUrl || DEFAULT_CONFIG.llmBaseUrl).replace(/\/$/, '');
    let model = config.llmModel || DEFAULT_CONFIG.llmModel;
    if (!apiKey) throw new Error('未配置 LLM API Key');

    let apiType = config.llmApiType || DEFAULT_CONFIG.llmApiType;
    if (apiType === 'auto') apiType = 'openai';

    log(`[LLM] API类型=${apiType}, Base=${baseUrl}, 模型=${model}`);

    if (apiType === 'anthropic') {
      const userContent = [];
      if (imageDataUrl) {
        const [header, base64] = imageDataUrl.split(',');
        const mediaType = header ? header.replace(/^data:/, '').replace(/;base64$/, '') : 'image/png';
        userContent.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
      }
      userContent.push({ type: 'text', text: prompt });
      const text = await llmFetchViaBackground(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'user', content: userContent }], system: '你是一位招聘筛选专家，请严格按用户要求输出JSON格式，不要输出任何其他内容。' }),
      });
      return extractTextFromLLMResponse(text);
    }

    const userContent = [];
    if (imageDataUrl) userContent.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    userContent.push({ type: 'text', text: prompt });
    const temp = baseUrl.includes('api.kimi.com/coding') ? 1 : 0.3;
    const reqBody = { model, messages: [{ role: 'user', content: userContent }], temperature: temp, max_tokens: 500 };
    // DeepSeek 默认开启思考模式（effort=high）：识图找坐标/岗位评分不需要思维链，
    // 开着会拖慢响应、挤占 max_tokens，还容易顶到 background 的请求超时，这里显式关闭。
    if (baseUrl.includes('deepseek.com')) reqBody.thinking = { type: 'disabled' };
    const text = await llmFetchViaBackground(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(reqBody),
    });
    return extractTextFromLLMResponse(text);
  }

  // ===== 视觉点击 =====
  async function captureScreenshot() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, (result) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!result || !result.ok) return reject(new Error(result?.error || '截图失败'));
        resolve(result.dataUrl);
      });
    });
  }

  async function visionClick(text, hint = '页面顶部') {
    if (!config.llmApiKey) {
      log('[视觉] 未配置 API Key，无法识图点击');
      return false;
    }
    log(`[视觉] 定位并点击: "${text}" (${hint})`);

    for (let attempt = 0; attempt <= 1; attempt++) {
      let dataUrl;
      try {
        dataUrl = await captureScreenshot();
      } catch (e) {
        log(`[视觉] 截图失败: ${e.message}`);
        return false;
      }

      const prompt = `你正在操作 Boss 直聘网页。当前截图中${hint}有可见元素/按钮/标签。请精确找到文本完全为 "${text}" 的单个可点击元素，返回该元素中心点在截图视口中的坐标（整数像素）。若目标文本含括号，全角括号"（）"与半角括号"()"视为相同。只输出 JSON：{"x": 整数, "y": 整数}。如果找不到或不确定，返回 {"found": false}。`;

      try {
        const resp = await callLLM(prompt, dataUrl);
        const jsonStr = extractFirstJsonObject(resp);
        if (!jsonStr) { log('[视觉] LLM 未返回坐标 JSON'); return false; }
        const result = JSON.parse(jsonStr);
        if (result.found === false || typeof result.x !== 'number' || typeof result.y !== 'number') {
          log('[视觉] LLM 表示未找到目标');
          return false;
        }
        const x = Math.round(result.x);
        const y = Math.round(result.y);

        // 截图可能是设备物理像素，需缩放到 CSS 视口坐标
        let cssX = x, cssY = y;
        try {
          const img = new Image();
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
          const scaleX = window.innerWidth / img.naturalWidth;
          const scaleY = window.innerHeight / img.naturalHeight;
          cssX = x * scaleX;
          cssY = y * scaleY;
          log(`[视觉] 截图尺寸 ${img.naturalWidth}x${img.naturalHeight}，缩放 (${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`);
        } catch (e) {
          log(`[视觉] 缩放计算失败，使用原始坐标: ${e.message}`);
        }

        if (cssX < 0 || cssY < 0 || cssX > window.innerWidth || cssY > window.innerHeight) {
          log(`[视觉] 坐标超出视口: (${cssX}, ${cssY})`);
          return false;
        }
        log(`[视觉] AI 返回坐标: (${x}, ${y}) → CSS 坐标: (${Math.round(cssX)}, ${Math.round(cssY)})，准备点击`);
        clickAtCoordinates(cssX, cssY);
        await sleep(randomBetween(2500, 3500));
        return true;
      } catch (e) {
        log(`[视觉] 点击失败: ${e.message}`);
        if (attempt === 0) {
          log('[视觉] 准备重试');
          await sleep(1500);
        }
      }
    }
    return false;
  }

  // ===== LLM 评分 =====
  // 根据岗位名称做兜底评分，LLM 解析失败时使用；返回 { score, reason }
  function fallbackScoreByTitle(title) {
    if (!title) return { score: 30, reason: '岗位标题为空' };
    const t = title.toLowerCase();
    const strong = /电商|天猫|淘宝|抖音|小红书|直播|货架|内容|网店|店长|运营总监|运营经理|运营负责人|新媒体|品牌运营/;
    const medium = /运营|市场|推广|增长|用户|产品|策划/;
    if (strong.test(t)) return { score: 78, reason: '岗位名称含电商关键词' };
    if (medium.test(t)) return { score: 55, reason: '岗位方向沾边，但不够精准' };
    return { score: 30, reason: '岗位方向与货架/内容电商不匹配' };
  }

  function extractScoreFromText(text) {
    if (!text) return -1;
    // 优先提取 JSON 中的 score
    const jsonMatch = text.match(/\{[\s\S]*?"score"\s*:\s*(\d+)[\s\S]*?\}/);
    if (jsonMatch) return parseInt(jsonMatch[1], 10);
    // 兜底：找文本中第一个 0-100 的数字
    const numMatch = text.match(/(?:评分|分数|score)[^\d]*(\d{1,3})/i);
    if (numMatch) {
      const n = parseInt(numMatch[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
    return -1;
  }

  function extractReasonFromText(text) {
    if (!text) return '';
    const jsonMatch = text.match(/\{[\s\S]*?"reason"\s*:\s*"([^"]*)"[\s\S]*?\}/);
    if (jsonMatch) return jsonMatch[1].trim();
    return '';
  }

  async function scoreJobWithLLM(info) {
    const desc = extractJobDescription();
    const titleLower = (info.title || '').toLowerCase();
    const descLower = (desc || '').toLowerCase();
    const hasEcommerce = /电商|天猫|淘宝|抖音|小红书|直播|货架|内容|网店|店长|新媒体|品牌运营|电商运营|电商总监|运营负责人|电商经理/.test(titleLower + descLower);
    const hasFinance = /消费金融|金融|信贷|贷款|小贷|借贷|保险|风控|催收|银行理财|基金|证券|投行/.test(titleLower + descLower);
    if (hasFinance && !hasEcommerce) {
      return { score: 25, reason: '金融/信贷方向，与货架/内容电商不匹配' };
    }
    // 跨境/亚马逊方向用户明确不投，无论 LLM 是否开启都直接压低
    const hasCrossBorder = /跨境|亚马逊|amazon/i.test(titleLower + descLower);
    if (hasCrossBorder) {
      return { score: 25, reason: '跨境/亚马逊方向，不投递' };
    }
    // 设计类岗位用户明确不投，无论 LLM 是否开启都直接压低
    const hasDesign = /设计|设计师|美工|视觉|原画|插画|3D|C4D|UI|UX|平面|P图|修图|抠图/i.test(titleLower + descLower);
    if (hasDesign) {
      return { score: 25, reason: '设计类岗位，不投递' };
    }
    // 娱乐/MNC/艺人经纪方向用户明确不投
    const hasEntertainment = /娱乐|传媒公司|艺人|经纪公司|演艺/i.test(titleLower + descLower);
    if (hasEntertainment) {
      return { score: 25, reason: '娱乐/传媒方向，不投递' };
    }

    // 限制描述长度，避免超长岗位描述导致 LLM 请求过大/过慢
    const shortDesc = (desc || '').slice(0, 1000);

    if (!config.useLlmScoring) {
      const fallback = fallbackScoreByTitle(info.title);
      log(`[LLM评分] 已关闭 LLM，使用标题兜底分数: ${fallback.score}`);
      return { ...fallback, reason: `已关闭LLM评分；${fallback.reason}` };
    }

    const prompt = `你是一位招聘筛选专家。请判断以下岗位是否与【货架电商 / 内容电商】方向匹配，并给出 0-100 的整数评分。只输出 JSON，不要输出任何其他内容。

岗位信息：
岗位名称：${info.title}
薪资：${info.salary}
城市：${info.city}
公司：${info.company}
岗位描述：${shortDesc || '无'}

评分规则：
- 岗位名称或描述明确涉及电商、天猫、淘宝、抖音电商、小红书运营、直播运营、品牌运营、电商总监、运营负责人、电商经理、新媒体运营：70-100 分
- 岗位方向沾边（如用户运营、产品运营、市场推广、用户增长）但不明确涉及电商：40-69 分
- 岗位方向明显不相关（如金融、信贷、保险、风控、客服、销售、行政、人事、跨境电商、亚马逊运营、设计、设计师、美工、视觉、UI、UX、平面、娱乐、传媒、艺人经纪）：0-39 分
- 特别注意：如果岗位名称或描述含有"消费金融"、"金融"、"信贷"、"贷款"、"保险"、"风控"、"催收"、"银行理财"等关键词，且未明确提到电商/天猫/淘宝/抖音/小红书/直播/货架/内容电商/网店/店长/新媒体/品牌运营，必须评为 0-39 分。
- 特别注意：如果岗位名称或描述含有"跨境"、"亚马逊"、"Amazon"等关键词，一律视为跨境电商方向，必须评为 0-39 分。
- 特别注意：如果岗位名称或描述含有"设计"、"设计师"、"美工"、"视觉"、"原画"、"插画"、"3D"、"C4D"、"UI"、"UX"、"平面"、"P图"、"修图"、"抠图"等关键词，一律视为设计类岗位，必须评为 0-39 分。
- 特别注意：如果岗位名称或描述含有"娱乐"、"传媒公司"、"艺人"、"演艺"、"经纪人"等关键词，一律视为娱乐传媒方向，必须评为 0-39 分。

输出格式示例：
{"score": 85, "reason": "电商运营岗，匹配度高"}`;

    try {
      const resp = await callLLM(prompt);
      log(`[LLM原始] ${resp.slice(0, 200).replace(/\n/g, ' ')}`);
      const score = extractScoreFromText(resp);
      if (score >= 0) {
        const llmReason = extractReasonFromText(resp) || 'LLM评分';
        // 二次校验：金融岗位且未提及电商，强制压低
        if (hasFinance && !hasEcommerce && score >= 40) {
          log(`[LLM评分] 金融岗位误评 ${score} 分，强制修正为 25 分`);
          return { score: 25, reason: '金融/信贷方向，与货架/内容电商不匹配（LLM评分已修正）' };
        }
        return { score, reason: llmReason };
      }
      const fallback = fallbackScoreByTitle(info.title);
      log(`[LLM评分] 解析失败，使用标题兜底分数: ${fallback.score}`);
      return { score: fallback.score, reason: `LLM未返回JSON；${fallback.reason}` };
    } catch (e) {
      const fallback = fallbackScoreByTitle(info.title);
      log(`[LLM评分] 调用异常: ${e.message}，使用标题兜底分数: ${fallback.score}`);
      return { score: fallback.score, reason: `LLM调用异常；${fallback.reason}` };
    }
  }

  // ===== 导航 =====
  async function ensureJobPage() {
    if (isJobListPage() && getJobCards().length > 0) return true;
    log('[导航] 当前不在职位列表页或没有职位卡片');

    for (const el of document.querySelectorAll('header a, header div, nav a, nav div, [class*="header"] a')) {
      if ((el.innerText || el.textContent || '').trim() === '职位' && isVisible(el)) {
        log('[导航] DOM 点击「职位」');
        simulateClick(el);
        await sleep(3000);
        if (isJobListPage() && getJobCards().length > 0) return true;
      }
    }

    const ok = await visionClick('职位', '顶部导航栏');
    if (ok) await sleep(3000);
    if (isJobListPage() && getJobCards().length > 0) return true;

    log('[导航] 点击无效，直接导航到标准职位列表页');
    location.assign('https://www.zhipin.com/web/geek/job');
    await sleep(3000);
    return isJobListPage() && getJobCards().length > 0;
  }

  // ===== 搜索页直达：构造「关键词+城市」搜索 URL，替代旧的点击求职期望标签 =====
  // Boss 搜索会从关键词中解析城市（搜「电商运营杭州」结果全是杭州职位，已实测验证）
  function ensureSearchPage() {
    const keyword = (config.searchKeyword || '').trim();
    if (!keyword) return false;
    const code = CITY_CODES[config.targetCity] || '';
    try {
      const url = new URL('https://www.zhipin.com/web/geek/job');
      url.searchParams.set('query', keyword);
      if (code) url.searchParams.set('city', code);
      const targetUrl = url.toString();

      const cur = new URL(location.href);
      const curQuery = (cur.searchParams.get('query') || '').trim();
      // v2.0.40：只比对关键词。Boss 会把 URL 的 city 参数重写为北京（实测），严格比对会导致每次启动重复跳转刷新。
      if (curQuery === keyword) return false; // 已在目标搜索页

      // 防循环：15 秒内已尝试跳转同一地址但 URL 仍未匹配（可能被站点重写），跳过避免反复刷新
      try {
        const last = JSON.parse(sessionStorage.getItem('bossAutoReplySearchNav') || '{}');
        if (last.url === targetUrl && Date.now() - (last.time || 0) < 15000) {
          log('[搜索] 刚已尝试跳转该搜索页但 URL 未生效，跳过避免循环刷新');
          return false;
        }
        sessionStorage.setItem('bossAutoReplySearchNav', JSON.stringify({ url: targetUrl, time: Date.now() }));
      } catch (e) {}

      log(`[搜索] 跳转到搜索页: ${targetUrl}`);
      saveState({ isRunning: true, stats, jobListUrl: targetUrl });
      location.assign(targetUrl);
      return true;
    } catch (e) {
      log(`[搜索] 构造搜索页失败: ${e.message}`);
      return false;
    }
  }

  // ===== 聊天页处理 =====
  async function processChatPage() {
    log('[聊天页] 进入聊天流程');
    const state = loadState();
    if (!state.isRunning || !state.currentJobId) {
      log('[聊天页] 无运行状态或岗位信息，停止');
      stopRun();
      return;
    }

    if (state.stats) stats = { ...stats, ...state.stats };

    if (stats.success >= config.dailyLimit) {
      log(`[上限] 已达到每日上限 ${config.dailyLimit} 条，停止`);
      stopRun();
      return;
    }

    const greeting = config.greeting.replace(/【岗位名】/g, cleanJobTitle(state.currentJobTitle) || '该岗位');

    // 等待输入框出现
    let input = null;
    const start = Date.now();
    while (Date.now() - start < 10000) {
      input = findChatInput();
      if (input) break;
      await sleep(500);
    }

    if (!input) {
      log('[聊天页] 未找到输入框');
      stats.failed++;
      saveState({ stats });
      await goBackToList(state.jobListUrl);
      return;
    }

    log('[聊天页] 填充开场白');
    const sendResult = await sendInChatPanel(input, greeting);
    if (sendResult.ok) {
      log('[聊天页] 开场白已发送');
      stats.success++;
      recordSent(state.currentJobId);
    } else {
      log(`[聊天页] 发送失败: ${sendResult.reason}`);
      stats.failed++;
    }

    await sleep(1000);
    await goBackToList(state.jobListUrl);
  }

  async function goBackToList(jobListUrl) {
    log('[返回] 返回职位列表');
    try { sessionStorage.setItem(RETURN_FLAG, '1'); } catch (e) {}
    if (isJobListPage() && getJobCards().length > 0) return true;
    const url = jobListUrl || 'https://www.zhipin.com/web/geek/job';
    location.assign(url);
    return true;
  }

  // ===== 求职期望标签（v2.0.41 恢复，代码移植自 v2.0.34 成熟版）=====
  // 用户指定（2026-09-03）：职位来源改回点击顶部「国内电商运营（杭州）」标签；搜索直达降级为兜底。
  // v2.0.34 已修坑：标签异步加载（最多等6秒）、全半角括号归一化、active 类/aria-selected 双路激活判断、
  // 精确→模糊评分→全文档兜底三层匹配；模糊层要求城市命中（+10）防误点其他标签。
  function normalizeTabText(text) {
    if (!text) return '';
    return text
      .replace(/[（(]/g, '(')
      .replace(/[）)]/g, ')')
      .replace(/\s+/g, '')
      .trim();
  }

  // 提取页面顶部推荐标签候选，优先用 title/aria-label 避免 CSS 截断
  function extractTopTabs() {
    const selectors = 'a, button, [role="tab"], li, div, span';
    const excluded = new Set(['首页', '职位', '公司', '校园·海归', 'APP', '有了', '海外', '项目外包', '推荐', '兼职', '求职类型', '薪资待遇', '工作经验', '学历要求', '公司行业', '公司规模', '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '西安', '加载中', '请稍候', '加载中，请稍候']);
    const map = new Map();
    document.querySelectorAll(selectors).forEach(el => {
      if (!isVisible(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.top > 400) return;
      const rawText = (el.innerText || el.textContent || '').trim();
      const fullText = (el.getAttribute('title') || el.getAttribute('aria-label') || rawText).trim();
      if (!fullText || fullText.length > 22 || /^\d+$/.test(fullText)) return;
      if (fullText.length < 2) return;
      if (excluded.has(fullText)) return;
      if (/^(搜索|筛选|排序|更多|收起|展开|确定|取消|重置|全部|城市)$/.test(fullText)) return;
      const tag = el.tagName && el.tagName.toLowerCase();
      const role = el.getAttribute && el.getAttribute('role');
      const cursor = window.getComputedStyle(el).cursor;
      const isClickable = tag === 'a' || tag === 'button' || role === 'tab' || role === 'button' || cursor === 'pointer';
      if (!isClickable) return;
      if (!map.has(fullText)) map.set(fullText, el);
    });
    return Array.from(map.entries()).map(([text, el]) => ({ text, el }));
  }

  function isTargetTabActive() {
    const targetCityCode = CITY_CODES[config.targetCity] || '';
    const hasTargetQuery = location.href.includes(encodeURIComponent(config.targetTab.replace(/[()]/g, ''))) ||
      location.href.includes(encodeURIComponent(config.targetTab.replace(/[()（）]/g, '')));
    const hasCityParam = targetCityCode ? location.href.includes(`city=${targetCityCode}`) : true;
    if (hasCityParam && hasTargetQuery) return true;

    // 部分 SPA 切换标签时不改 URL，通过 active 类 / aria-selected 兜底判断
    const targetNorm = normalizeTabText(config.targetTab);
    for (const el of document.querySelectorAll('a, button, [role="tab"], div, span, li')) {
      if (normalizeTabText((el.innerText || el.textContent || '').trim()) !== targetNorm) continue;
      const ariaSelected = el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'true';
      const cls = (el.className || '').toString().toLowerCase();
      const activeClass = cls.includes('active') || cls.includes('selected') || cls.includes('current');
      if (ariaSelected || activeClass) return true;
    }
    return false;
  }

  async function clickTargetTab() {
    const targetNorm = normalizeTabText(config.targetTab);
    if (isTargetTabActive()) {
      log('[标签] 当前已在目标标签页，跳过点击');
      return true;
    }

    // 等待顶部推荐标签渲染完成（最多 6 秒）
    let topTabs = [];
    const waitStart = Date.now();
    while (Date.now() - waitStart < 6000) {
      topTabs = extractTopTabs();
      const nonLoading = topTabs.filter(t => !/加载|请稍候|loading/i.test(t.text));
      if (nonLoading.length > 0) break;
      log('[标签] 顶部标签加载中，等待...');
      await sleep(800);
    }
    log(`[标签] 顶部候选标签: ${topTabs.slice(0, 12).map(t => t.text).join(' / ')}`);

    // 第1层：DOM 精确匹配
    const exactTop = topTabs.find(t => normalizeTabText(t.text) === targetNorm);
    if (exactTop) {
      log(`[标签] DOM 精确点击: ${exactTop.text}`);
      simulateClick(exactTop.el);
      await sleep(3000);
      if (isTargetTabActive()) return true;
      log('[标签] DOM 精确点击后目标标签未激活，尝试模糊匹配');
    }

    // 第2层：按目标城市 + 岗位关键词拆分后评分匹配（城市命中 +10，每个关键词 +3）
    const targetCity = (config.targetCity || '').trim();
    const targetKeywords = (config.targetTab || '')
      .replace(/[（(].*?[）)]/g, '')
      .split(/[\s\/·]+/)
      .filter(k => k.length >= 2);
    if (targetCity && targetKeywords.length > 0) {
      const scoredTabs = topTabs
        .map(t => {
          const nt = normalizeTabText(t.text);
          let score = 0;
          if (nt.includes(targetCity)) score += 10;
          targetKeywords.forEach(kw => { if (nt.includes(kw)) score += 3; });
          return { tab: t, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scoredTabs.length > 0) {
        const best = scoredTabs[0];
        log(`[标签] DOM 模糊匹配顶部候选: ${best.tab.text}（城市=${targetCity}, 关键词=${targetKeywords.join('/')}, 得分=${best.score}）`);
        simulateClick(best.tab.el);
        await sleep(3000);
        if (isTargetTabActive()) return true;
      }
    }

    // 第3层：全文档兜底精确匹配
    for (const el of document.querySelectorAll('a, button, [role="tab"], div, span, li')) {
      const text = (el.innerText || el.textContent || '').trim();
      if (normalizeTabText(text) === targetNorm && isVisible(el)) {
        log(`[标签] DOM 兜底点击目标标签: ${text}`);
        simulateClick(el);
        await sleep(3000);
        if (isTargetTabActive()) return true;
      }
    }

    log('[标签] 所有点击方式均未激活目标标签');
    return false;
  }

  // 职位来源保障：优先激活求职期望标签；标签不可用（被站点下线/未渲染）时回退搜索直达。
  // 返回 true = 已发起页面跳转，调用方需中断本次执行等 autoResume。
  async function ensureJobSource() {
    // 点击标签可能触发页面跳转（v2.0.34 经验），先保存运行状态供跳转后 autoResume 恢复
    saveState({ isRunning: true, stats, jobListUrl: location.href });
    const tabOk = await clickTargetTab();
    if (tabOk) return false;
    log('[标签] 目标标签不可用，回退搜索直达兜底');
    return ensureSearchPage();
  }

  // [已删除 v2.0.40] ensureCity()：Boss 会把 URL 的 city 参数重写为北京（实测），该函数会造成每次启动重复跳转。
  // 城市保障现在由三层承担：① 搜索关键词内嵌城市（Boss 从关键词解析，已实测）② ensureSearchPage 构造 URL 带 city 参数 ③ 卡片级城市过滤。

  // ===== 主流程 =====
  async function processJobListPage() {
    log('===== 开始职位页拓客 =====');
    log(`[配置] 城市=${config.targetCity}, 标签=${config.targetTab}, 搜索兜底=${config.searchKeyword}, 薪资=${config.salaryMin}-${config.salaryMax}K, 日限额=${config.dailyLimit}`);

    if (stats.success >= config.dailyLimit) {
      log(`[上限] 已达到每日上限 ${config.dailyLimit} 条，停止`);
      stopRun();
      return;
    }

    const jobListUrl = location.href;
    const processedThisPage = new Set();
    let consecutiveNoNew = 0;

    while (isRunning && !shouldStop) {
      const cards = getJobCards().filter(c => isVisible(c));
      log(`[列表] 当前可见职位卡片 ${cards.length} 个`);
      if (cards.length === 0) {
        consecutiveNoNew++;
        if (consecutiveNoNew > 5) {
          log('[刷新] 无职位卡片，刷新页面');
          saveState({ isRunning: true, stats, jobListUrl });
          location.reload();
          return;
        }
        await sleep(1000);
        continue;
      }
      consecutiveNoNew = 0;

      let newCardFound = false;
      for (const card of cards) {
        if (!isRunning || shouldStop) break;
        if (stats.success >= config.dailyLimit) break;

        const info = extractCardInfo(card);
        if (!info.title || processedThisPage.has(info.jobId)) continue;
        processedThisPage.add(info.jobId);
        stats.total++;
        newCardFound = true;
        markCard(card, 'pending');

        if (config.targetCity && !info.city.includes(config.targetCity)) {
          markCard(card, 'city_mismatch', `城市=${info.city}`);
          log(`[过滤] 城市不匹配: ${info.city}`);
          stats.skipped++;
          continue;
        }

        if (info.title.includes('合伙人')) {
          markCard(card, 'partner', `标题=${info.title}`);
          log(`[过滤] 合伙人岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (info.title.includes('京东')) {
          markCard(card, 'jingdong', `标题=${info.title}`);
          log(`[过滤] 京东岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (/跨境|亚马逊|amazon/i.test(info.title + info.company)) {
          markCard(card, 'crossborder', `标题=${info.title}`);
          log(`[过滤] 跨境/亚马逊岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (/设计|设计师|美工|视觉|原画|插画|3D|C4D|UI|UX|平面|P图|修图|抠图/i.test(info.title + info.company)) {
          markCard(card, 'design', `标题=${info.title}`);
          log(`[过滤] 设计类岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (/娱乐/i.test(info.title + info.company)) {
          markCard(card, 'entertainment', `标题=${info.title}`);
          log(`[过滤] 娱乐岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (info.isHeadhunter || info.title.includes('猎头') || info.isAnonymousCompany) {
          const reason = info.isAnonymousCompany ? `匿名公司=${info.company}` : `标题=${info.title}`;
          markCard(card, 'headhunter', reason);
          log(`[过滤] 猎头/匿名公司岗位不投: ${info.title} | ${info.company}`);
          stats.skipped++;
          continue;
        }

        if (/商务/.test(info.title + info.company)) {
          markCard(card, 'business', `标题=${info.title}`);
          log(`[过滤] 商务岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (info.title.includes('主播')) {
          markCard(card, 'anchor', `标题=${info.title}`);
          log(`[过滤] 主播岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (info.title.includes('实习')) {
          markCard(card, 'intern', `标题=${info.title}`);
          log(`[过滤] 实习岗位不投: ${info.title}`);
          stats.skipped++;
          continue;
        }

        if (info.salaryMax > 0 && info.salaryMax < config.salaryMin) {
          markCard(card, 'salary_low', `薪资=${info.salary}`);
          log(`[过滤] 薪资过低: ${info.salary}`);
          stats.skipped++;
          continue;
        }
        if (info.salaryMin > 0 && info.salaryMin > config.salaryMax) {
          markCard(card, 'salary_high', `薪资=${info.salary}`);
          log(`[过滤] 薪资过高: ${info.salary}`);
          stats.skipped++;
          continue;
        }

        if (isDuplicate(info.jobId)) {
          markCard(card, 'duplicate', '30天内已沟通过');
          log(`[去重] 已沟通过: ${info.title}`);
          stats.skipped++;
          continue;
        }

        log(`[详情] 展开岗位: ${info.title}`);
        markCard(card, 'scoring', 'LLM评分中');
        const detailOpened = await openJobDetail(card, info);
        if (!detailOpened) {
          markCard(card, 'failed', '右侧详情未更新', '失败:详情未展开');
          log(`[详情] 展开失败，跳过: ${info.title}`);
          stats.failed++;
          continue;
        }
        extractJobDescription();

        log(`[LLM评分] 开始评分: ${info.title}`);
        const scoreResult = await scoreJobWithLLM(info);
        log(`[LLM评分] 岗位=${info.title}, 分数=${scoreResult.score}, 原因=${scoreResult.reason}`);

        if (scoreResult.score < config.llmThreshold) {
          markCard(card, 'score_low', `${scoreResult.score}分｜${scoreResult.reason}`, `分数不足:${scoreResult.score}`);
          log(`[跳过] 分数 ${scoreResult.score} 低于阈值 ${config.llmThreshold}`);
          stats.skipped++;
          continue;
        }

        // 先显示评分 2 秒，再进入沟通
        markCard(card, 'score_pass', `${scoreResult.score}分｜${scoreResult.reason}`, `评分:${scoreResult.score}`);
        log(`[评分通过] ${scoreResult.score} 分，2 秒后开始沟通`);
        await sleep(2000);

        log(`[沟通] 点击沟通: ${info.title}`);
        markCard(card, 'chatting', '进入沟通');
        let chatInterface = null;

        // 方法1：DOM 直接查找并点击（最快、最稳）
        log('[沟通] 先尝试 DOM 查找立即沟通');
        let chatBtn = findChatButton(card);
        if (!chatBtn) {
          await sleep(1500);
          chatBtn = findChatButton(card);
        }
        if (chatBtn) {
          const btnText = (chatBtn.innerText || chatBtn.textContent || '').trim();
          log(`[沟通] DOM 找到按钮: "${btnText}"`);
          saveState({ isRunning: true, stats, currentJobId: info.jobId, currentJobTitle: cleanJobTitle(info.title), jobListUrl });
          simulateClick(chatBtn);
          await sleep(4000);

          if (isChatPage()) {
            await processChatPage();
            return;
          }

          chatInterface = await waitForChatInterface(6000);

          if (!chatInterface) {
            log('[沟通] 首次 DOM 点击未触发，重试');
            const chatBtn2 = findChatButton(card);
            if (chatBtn2) {
              simulateClick(chatBtn2);
              await sleep(4000);
              chatInterface = await waitForChatInterface(6000);
            }
          }
        }

        // 方法2：AI 视觉兜底
        if (!chatInterface) {
          log('[沟通] DOM 未进入聊天，尝试 AI 视觉定位右侧立即沟通按钮');
          const visionOk = await visionClick('立即沟通', '右侧职位详情面板');
          if (visionOk) {
            await sleep(4500);
            if (isChatPage()) {
              await processChatPage();
              return;
            }
            chatInterface = await waitForChatInterface(6000);
          }
        }

        if (!chatInterface) {
          markCard(card, 'failed', '未进入聊天页或弹窗', '失败:未进弹窗');
          log('[沟通] 未进入聊天页或弹窗');
          stats.failed++;
          continue;
        }

        if (chatInterface.type === 'page') {
          saveState({ isRunning: true, stats, currentJobId: info.jobId, currentJobTitle: cleanJobTitle(info.title), jobListUrl });
          await processChatPage();
          return;
        }

        if (chatInterface.type === 'panel') {
          const panelInput = chatInterface.input;
          const greeting = config.greeting.replace(/【岗位名】/g, cleanJobTitle(info.title) || '该岗位');
          const sendResult = await sendInChatPanel(panelInput, greeting);
          if (sendResult.ok) {
            markCard(card, 'sent', '弹窗内已发送');
            log('[沟通] 弹窗内已发送');
            stats.success++;
            recordSent(info.jobId);
          } else {
            markCard(card, 'failed', sendResult.reason, '失败:发送未清空');
            log(`[沟通] 弹窗发送失败: ${sendResult.reason}`);
            stats.failed++;
          }
          const closeBtn = document.querySelector('.close, [class*="close"], [class*="icon-close"], [class*="icon-close-btn"]');
          if (closeBtn) simulateClick(closeBtn);
          await sleep(1500);
        }

        saveState({ isRunning: true, stats, jobListUrl });
        await sleep(randomBetween(config.intervalMin * 1000, config.intervalMax * 1000));
      }

      if (!newCardFound) consecutiveNoNew++;

      log('[滚动] 向下加载更多');
      window.scrollBy(0, window.innerHeight * 0.7);
      await sleep(randomBetween(2000, 3000));

      if (consecutiveNoNew > 3) {
        log('[刷新] 列表到底，刷新页面继续');
        saveState({ isRunning: true, stats, jobListUrl });
        location.reload();
        return;
      }
    }

    log('[停止] 主循环结束');
  }

  async function startRun() {
    if (isStarting) return;
    isStarting = true;
    log(`[启动] v${PLUGIN_VERSION} 当前页面: ${location.href}`);
    log(`[启动] 当前职位卡片数=${getJobCards().length}`);
    log(`[诊断] APIKey存在=${!!config.llmApiKey}, 城市=${config.targetCity}, 标签=${config.targetTab}, 搜索兜底=${config.searchKeyword}`);

    if (config.workHoursOnly && !isInWorkHours()) {
      log('[停止] 不在工作时间 9:00-18:00');
      isStarting = false;
      return;
    }

    isRunning = true;
    shouldStop = false;

    if (isChatPage()) {
      await processChatPage();
      isStarting = false;
      return;
    }

    if (isJobListPage()) {
      const sourceNavigating = await ensureJobSource();
      if (sourceNavigating) {
        log('[来源] 职位来源跳转中（标签点击触发的页面跳转或搜索兜底），暂停当前执行');
        isStarting = false;
        return;
      }
    }

    if (sessionStorage.getItem(RETURN_FLAG) === '1') {
      sessionStorage.removeItem(RETURN_FLAG);
      log('[恢复] 从聊天页返回');
      if (isJobListPage()) {
        saveState({ isRunning: true, stats, jobListUrl: location.href });
        const sourceNavigating = await ensureJobSource();
        if (sourceNavigating) {
          log('[来源] 返回后职位来源跳转中，暂停当前执行');
          isStarting = false;
          return;
        }
        await processJobListPage();
        isStarting = false;
        return;
      }
    }

    if (!isJobListPage()) {
      saveState({ isRunning: true, stats });
      const entered = await ensureJobPage();
      if (!entered) {
        log('[错误] 无法进入职位列表页');
        stopRun();
        isStarting = false;
        return;
      }
      if (!isJobListPage()) {
        isStarting = false;
        return;
      }
    }

    const sourceNavigating = await ensureJobSource();
    if (sourceNavigating) {
      log('[来源] 职位来源跳转中，暂停当前执行');
      isStarting = false;
      return;
    }

    saveState({ isRunning: true, stats, jobListUrl: location.href });
    await processJobListPage();
    isStarting = false;
  }

  function stopRun() {
    isRunning = false;
    shouldStop = true;
    clearState();
    log('[停止] 用户停止运行');
    try { chrome.runtime.sendMessage({ action: 'stopped' }); } catch (e) {}
  }

  function isInWorkHours() {
    const h = new Date().getHours();
    return h >= 9 && h < 18;
  }

  function autoResume() {
    const state = loadState();
    if (!state.isRunning) return;
    if (isRunning || isStarting) return;
    log('[恢复] 自动恢复运行');
    isRunning = true;
    shouldStop = false;
    if (state.stats) stats = { ...stats, ...state.stats };
    if (isChatPage()) {
      processChatPage();
    } else {
      startRun();
    }
  }

  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg.action === 'start') {
        if (msg.config) config = migrateConfig(msg.config);
        stats = { total: 0, success: 0, skipped: 0, failed: 0 };
        await startRun();
        sendResponse({ ok: true });
      }
      if (msg.action === 'stop') {
        stopRun();
        sendResponse({ ok: true });
      }
      if (msg.action === 'updateConfig') {
        if (msg.config) config = { ...DEFAULT_CONFIG, ...msg.config };
        sendResponse({ ok: true });
      }
      if (msg.action === 'getLogs') {
        sendResponse({ logs: getLogs(msg.limit || 100) });
      }
      if (msg.action === 'clearSent') {
        try {
          const map = getSentMap();
          const count = Object.keys(map).length;
          localStorage.removeItem(SENT_KEY);
          log(`[去重] 已清空 ${count} 条发送记录`);
          sendResponse({ success: true, count });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      }
    })();
    return true;
  });

  Promise.all([loadConfig(), initLogs(), cleanExpiredSent()]).then(() => {
    window.__BOSS_AUTO_REPLY_INJECTED__ = true;
    window.__BOSS_AUTO_REPLY_VERSION__ = PLUGIN_VERSION;
    autoResume();
  });

  window.addEventListener('boss-auto-reply-force-stop', () => {
    log('[强制停止] 收到强制停止信号，立即终止运行');
    stopRun();
  });

})();
