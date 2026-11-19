// popup.js - Boss直聘自动拓客插件配置面板 v2.0.0

const DEFAULT_CONFIG = {
  targetCity: "杭州",
  targetTab: "国内电商运营（杭州）",
  searchKeyword: "电商运营杭州",
  salaryMin: 20,
  salaryMax: 100,
  dailyLimit: 150,
  intervalMin: 30,
  intervalMax: 90,
  workHoursOnly: true,
  greeting: "您好，看到贵司在招【岗位名】。我多年货架+内容电商经验，现主攻AI落地：搭自动化工作流、用AI员工承接重复性运营工作，辅以数据分析与复盘，实现人效提升与人力成本优化。成果见简历，方便可深聊。",
  llmApiKey: "",
  llmApiType: "auto",
  llmBaseUrl: "https://api.deepseek.com/v1",
  llmModel: "deepseek-flash",
  llmThreshold: 70,
  useLlmScoring: true,
};
const STORAGE_KEY = "bossAutoReplyConfig_v2";

// v2.0.41 迁移：职位来源改回点击求职期望标签（标签优先，搜索词降级为兜底）+ 薪资下限 30K；__v2041 标记防重复迁移
// v2.0.42 迁移：薪资下限 30K→20K（20K 岗位也投递）；__v2042 标记防重复迁移
function migrateConfig(raw) {
  const cfg = { ...DEFAULT_CONFIG, ...(raw || {}) };
  if (!cfg.__v2041) {
    cfg.searchKeyword = "电商运营杭州";
    cfg.salaryMin = 30;
    cfg.targetTab = "国内电商运营（杭州）";
    delete cfg.siteSalaryFilter;
    cfg.__v2041 = true;
  }
  if (!cfg.__v2042) {
    cfg.salaryMin = 20;
    cfg.__v2042 = true;
  }
  // v2.0.43 迁移：LLM 提供商由 Kimi 切到 DeepSeek（2026-11-10）。旧 Kimi/Moonshot 地址自动改地址与模型，
  // 旧密钥一并清空（原地址是 Kimi，密钥必然是 Kimi 的，留着只会 401），等用户填 DeepSeek Key；__v2043 防重复迁移
  if (!cfg.__v2043) {
    if (/api\.kimi\.com|moonshot/.test(cfg.llmBaseUrl || '')) {
      cfg.llmBaseUrl = DEFAULT_CONFIG.llmBaseUrl;
      cfg.llmModel = DEFAULT_CONFIG.llmModel;
      cfg.llmApiKey = '';
    }
    cfg.__v2043 = true;
  }
  return cfg;
}

async function loadConfig() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const migrated = migrateConfig(result[STORAGE_KEY]);
    if (!result[STORAGE_KEY] || !result[STORAGE_KEY].__v2043) {
      await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
    }
    return migrated;
  } catch (e) {
    console.warn('[Boss拓客] 加载配置失败:', e);
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
    return true;
  } catch (e) {
    console.warn('[Boss拓客] 保存配置失败:', e);
    return false;
  }
}

function readForm() {
  const salaryMin = parseInt(document.getElementById("salaryMin").value);
  const salaryMax = parseInt(document.getElementById("salaryMax").value);
  const dailyLimit = parseInt(document.getElementById("dailyLimit").value);
  const intervalMin = parseInt(document.getElementById("intervalMin").value);
  const intervalMax = parseInt(document.getElementById("intervalMax").value);
  const llmThreshold = parseInt(document.getElementById("llmThreshold").value);
  return {
    targetCity: document.getElementById("targetCity").value || DEFAULT_CONFIG.targetCity,
    targetTab: document.getElementById("targetTab").value || DEFAULT_CONFIG.targetTab,
    searchKeyword: document.getElementById("searchKeyword").value || DEFAULT_CONFIG.searchKeyword,
    salaryMin: Number.isNaN(salaryMin) ? DEFAULT_CONFIG.salaryMin : salaryMin,
    salaryMax: Number.isNaN(salaryMax) ? DEFAULT_CONFIG.salaryMax : salaryMax,
    dailyLimit: Number.isNaN(dailyLimit) ? DEFAULT_CONFIG.dailyLimit : dailyLimit,
    intervalMin: Number.isNaN(intervalMin) ? DEFAULT_CONFIG.intervalMin : intervalMin,
    intervalMax: Number.isNaN(intervalMax) ? DEFAULT_CONFIG.intervalMax : intervalMax,
    workHoursOnly: document.getElementById("workHoursOnly").checked,
    greeting: document.getElementById("greeting").value || DEFAULT_CONFIG.greeting,
    llmApiKey: document.getElementById("llmApiKey").value.trim(),
    llmApiType: document.getElementById("llmApiType").value || DEFAULT_CONFIG.llmApiType,
    llmBaseUrl: document.getElementById("llmBaseUrl").value || DEFAULT_CONFIG.llmBaseUrl,
    llmModel: document.getElementById("llmModel").value || DEFAULT_CONFIG.llmModel,
    llmThreshold: Number.isNaN(llmThreshold) ? DEFAULT_CONFIG.llmThreshold : llmThreshold,
    useLlmScoring: document.getElementById("useLlmScoring").checked,
  };
}

function fillForm(config) {
  document.getElementById("targetCity").value = config.targetCity || DEFAULT_CONFIG.targetCity;
  document.getElementById("targetTab").value = config.targetTab || DEFAULT_CONFIG.targetTab;
  document.getElementById("searchKeyword").value = config.searchKeyword || DEFAULT_CONFIG.searchKeyword;
  document.getElementById("salaryMin").value = config.salaryMin !== undefined ? config.salaryMin : DEFAULT_CONFIG.salaryMin;
  document.getElementById("salaryMax").value = config.salaryMax !== undefined ? config.salaryMax : DEFAULT_CONFIG.salaryMax;
  document.getElementById("dailyLimit").value = config.dailyLimit !== undefined ? config.dailyLimit : DEFAULT_CONFIG.dailyLimit;
  document.getElementById("intervalMin").value = config.intervalMin !== undefined ? config.intervalMin : DEFAULT_CONFIG.intervalMin;
  document.getElementById("intervalMax").value = config.intervalMax !== undefined ? config.intervalMax : DEFAULT_CONFIG.intervalMax;
  document.getElementById("workHoursOnly").checked = config.workHoursOnly !== false;
  document.getElementById("greeting").value = config.greeting || DEFAULT_CONFIG.greeting;
  document.getElementById("llmApiKey").value = config.llmApiKey || "";
  document.getElementById("llmApiType").value = config.llmApiType || DEFAULT_CONFIG.llmApiType;
  document.getElementById("llmBaseUrl").value = config.llmBaseUrl || DEFAULT_CONFIG.llmBaseUrl;
  document.getElementById("llmModel").value = config.llmModel || DEFAULT_CONFIG.llmModel;
  document.getElementById("llmThreshold").value = config.llmThreshold !== undefined ? config.llmThreshold : DEFAULT_CONFIG.llmThreshold;
  document.getElementById("useLlmScoring").checked = config.useLlmScoring !== false;
}

function updateStatus(text, type = "idle") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status " + type;
}

function updateStats(stats) {
  if (!stats) return;
  document.getElementById("statsSection").style.display = "block";
  document.getElementById("statTotal").textContent = stats.total || 0;
  document.getElementById("statSuccess").textContent = stats.success || 0;
  document.getElementById("statSkipped").textContent = stats.skipped || 0;
  document.getElementById("statFailed").textContent = stats.failed || 0;
}

async function sendToTab(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    updateStatus("未找到活动标签页", "error");
    return false;
  }
  if (!tab.url || !tab.url.includes("zhipin.com")) {
    updateStatus("请先在浏览器中打开Boss直聘", "error");
    return false;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
    return true;
  } catch (e) {
    updateStatus("发送失败: " + e.message, "error");
    return false;
  }
}

function renderLogs(logs) {
  const pre = document.getElementById("logResult");
  if (!logs || logs.length === 0) {
    pre.textContent = "暂无日志";
    return;
  }
  pre.textContent = logs.map(l => `[${l.time}] ${l.msg}`).join("\n");
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id ? tab : null;
}

function setButtons(running) {
  document.getElementById("btnStart").style.display = running ? "none" : "block";
  document.getElementById("btnStop").style.display = running ? "block" : "none";
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const manifest = chrome.runtime.getManifest();
    document.getElementById("version").textContent = "v" + manifest.version;
  } catch (e) {
    document.getElementById("version").textContent = "v?";
  }

  try {
    const config = await loadConfig();
    fillForm(config);
    // 自动迁移：若 key 是 Kimi Code 的 sk-kimi- 开头，而配置仍是 Moonshot 旧默认，则切换到 Kimi Code 默认 endpoint
    if (config.llmApiKey && config.llmApiKey.startsWith('sk-kimi-') && config.llmBaseUrl === 'https://api.moonshot.cn/v1') {
      const migrated = { ...config, llmBaseUrl: 'https://api.kimi.com/coding/v1', llmModel: 'kimi-for-coding' };
      await saveConfig(migrated);
      fillForm(migrated);
      updateStatus('已自动切换为 Kimi Code API 配置，请保存后测试', 'idle');
    }
  } catch (e) {
    console.warn('[Boss拓客] 初始化配置失败:', e);
  }

  document.getElementById("btnSave").addEventListener("click", async () => {
    try {
      const cfg = readForm();
      await saveConfig(cfg);
      updateStatus("配置已保存", "idle");
      await sendToTab({ action: "updateConfig", config: cfg });
    } catch (e) {
      updateStatus("保存失败: " + e.message, "error");
    }
  });

  document.getElementById("btnStart").addEventListener("click", async () => {
    try {
      const cfg = readForm();
      await saveConfig(cfg);
      const ok = await sendToTab({ action: "start", config: cfg });
      if (!ok) {
        updateStatus("正在重试...", "idle");
        await new Promise(r => setTimeout(r, 500));
        const ok2 = await sendToTab({ action: "start", config: cfg });
        if (!ok2) {
          updateStatus("content script 未注入，请刷新页面后重试", "error");
          return;
        }
      }
      updateStatus("拓客中...", "running");
      setButtons(true);
    } catch (e) {
      updateStatus("启动失败: " + e.message, "error");
    }
  });

  document.getElementById("btnStop").addEventListener("click", async () => {
    try {
      await sendToTab({ action: "stop" });
      updateStatus("已停止", "idle");
      setButtons(false);
    } catch (e) {
      updateStatus("停止失败: " + e.message, "error");
    }
  });

  document.getElementById("btnForceStop").addEventListener("click", async () => {
    updateStatus("强制停止中，清空状态并刷新页面...", "running");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            try { sessionStorage.removeItem('bossAutoReplyState_v2'); } catch (e) {}
            try { localStorage.removeItem('bossAutoReplyState_v2_cross_tab'); } catch (e) {}
            try { window.dispatchEvent(new CustomEvent('boss-auto-reply-force-stop')); } catch (e) {}
            setTimeout(() => { location.reload(); }, 300);
          }
        });
      }
      updateStatus("已强制停止，页面刷新后请重新点击开始", "idle");
      setButtons(false);
    } catch (e) {
      updateStatus("强制停止失败: " + e.message, "error");
    }
  });

  document.getElementById("btnDiagnose").addEventListener("click", async () => {
    updateStatus("诊断中...", "running");
    document.getElementById("diagnoseSection").style.display = "none";

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url || !tab.url.includes("zhipin.com")) {
        updateStatus("请先在浏览器中打开Boss直聘", "error");
        return;
      }

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const lines = [];
          lines.push(`当前页面: ${location.href}`);
          lines.push(`content script 注入标志: ${!!window.__bossAutoReplyLoaded}`);
          lines.push(`content script 版本: ${window.__BOSS_AUTO_REPLY_VERSION__ || '未知'}`);
          try {
            const state = JSON.parse(sessionStorage.getItem('bossAutoReplyState_v2') || '{}');
            lines.push(`运行状态: isRunning=${state.isRunning}, currentJobId=${state.currentJobId || '(空)'}, currentJobTitle=${state.currentJobTitle || '(空)'}`);
          } catch (e) {
            lines.push('运行状态: 读取失败');
          }
          lines.push('---');

          function parseSalary(text) {
            if (!text) return [0, 0];
            const normalized = text
              .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
              .replace(/[Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
              .replace(/－/g, '-');
            const m = normalized.match(/(\d+(?:\.\d+)?)\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[Kk千]/);
            if (m) return [parseFloat(m[1]), parseFloat(m[2])];
            const m2 = normalized.match(/(\d+(?:\.\d+)?)\s*[Kk千]/);
            if (m2) return [parseFloat(m2[1]), parseFloat(m2[1])];
            const PUA_BASE = 0xE031;
            const puaToNum = ch => { const n = ch.charCodeAt(0) - PUA_BASE; return n >= 0 && n <= 9 ? n : -1; };
            const decodeChars = chars => { let v = 0; for (const c of chars) { const n = puaToNum(c); if (n < 0) return -1; v = v * 10 + n; } return v; };
            const rm = normalized.match(/([-]+)\s*[-~–—]\s*([-]+)\s*[Kk千]/);
            if (rm) { const a = decodeChars(rm[1]), b = decodeChars(rm[2]); if (a >= 0 && b >= 0) return [a, b]; }
            const sm = normalized.match(/([-]+)\s*[Kk千]/);
            if (sm) { const a = decodeChars(sm[1]); if (a >= 0) return [a, a]; }
            return [0, 0];
          }

          const selectors = [
            '.job-list-wrapper .job-card-wrapper',
            '.search-job-result .job-card-wrapper',
            '[class*="job-list"] [class*="job-card"]',
            '.job-card-wrapper',
          ];
          selectors.forEach(sel => {
            try {
              const nodes = document.querySelectorAll(sel);
              let valid = 0;
              let sample = '';
              for (let i = 0; i < Math.min(3, nodes.length); i++) {
                const t = (nodes[i].innerText || '').trim();
                const [sMin, sMax] = parseSalary(t);
                if (t.length > 10 && (sMin > 0 || /科技|有限|公司|集团/.test(t))) {
                  valid++;
                  if (!sample) sample = t.slice(0, 80).replace(/\n/g, ' | ');
                }
              }
              lines.push(`选择器 ${sel}: 共${nodes.length} 有效${valid}` + (sample ? ` 样例: ${sample}` : ''));
            } catch (e) {
              lines.push(`选择器 ${sel}: 报错 ${e.message}`);
            }
          });

          const chatBtns = Array.from(document.querySelectorAll('button, a')).filter(b => /立即沟通|继续沟通/.test((b.innerText || b.textContent || '').trim()));
          const cardSet = new Set();
          for (const btn of chatBtns) {
            let ancestor = btn.parentElement;
            for (let d = 0; d < 8 && ancestor; d++) {
              const rect = ancestor.getBoundingClientRect();
              if (rect.width > 200 && rect.height > 60) { cardSet.add(ancestor); break; }
              ancestor = ancestor.parentElement;
            }
          }
          lines.push(`沟通按钮: ${chatBtns.length} 个，反查卡片: ${cardSet.size} 个`);
          chatBtns.slice(0, 3).forEach(btn => {
            const rect = btn.getBoundingClientRect();
            lines.push(`  - "${(btn.innerText || '').trim().slice(0, 20)}" 可见:${btn.offsetParent !== null && rect.width > 0 && rect.height > 0}`);
          });
          if (chatBtns.length === 0) lines.push('未找到"立即沟通"/"继续沟通"按钮');
          lines.push(`navigator.webdriver: ${navigator.webdriver}`);

          lines.push('--- 聊天页诊断 ---');
          const chatInputSelectors = [
            '.chat-editor[contenteditable="true"]',
            '.message-editor[contenteditable="true"]',
            '[contenteditable="true"]',
            'textarea',
            'input[type="text"]',
          ];
          chatInputSelectors.forEach(sel => {
            try {
              const visible = Array.from(document.querySelectorAll(sel)).filter(n => {
                const r = n.getBoundingClientRect();
                return n.offsetParent !== null && r.width > 0 && r.height > 0;
              });
              if (visible.length > 0) {
                lines.push(`输入框 ${sel}: 找到 ${visible.length} 个可见元素`);
                visible.forEach((n, i) => lines.push(`  [${i}] tag=${n.tagName}, class=${(n.className || '').toString().slice(0, 60)}, editable=${n.isContentEditable}`));
              }
            } catch (e) {}
          });

          const sendBtns = Array.from(document.querySelectorAll('button, [role="button"], div, span, a')).filter(b => {
            const t = (b.innerText || b.textContent || '').trim();
            const aria = (b.getAttribute('aria-label') || '').trim();
            const cls = (b.className || '').toString().toLowerCase();
            return /发送|Send/.test(t) || /发送|Send/.test(aria) || cls.includes('send');
          });
          lines.push(`发送按钮候选: ${sendBtns.length} 个`);
          sendBtns.slice(0, 5).forEach((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const style = window.getComputedStyle(btn);
            lines.push(`  [${i}] tag=${btn.tagName}, text="${(btn.innerText || '').trim().slice(0, 20)}", class=${(btn.className || '').toString().slice(0, 40)}, bg=${style.backgroundColor}, visible=${btn.offsetParent !== null && rect.width > 0 && rect.height > 0}`);
          });

          // ===== 深度自检（v2.0.39 诊断增强：只读取 + 一次可自动复原的下拉试验，不改拓客行为）=====
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const norm = s => (s || '').replace(/\s+/g, '');

          lines.push('--- 深度自检① 真实卡片结构（按 /job_detail/ 链接反查） ---');
          try {
            const detailLinks = Array.from(document.querySelectorAll('a[href*="/job_detail/"]')).filter(a => a.offsetParent !== null);
            lines.push(`含 /job_detail/ 可见链接: ${detailLinks.length} 个`);
            const cardRoots = [];
            const seenRoots = new Set();
            for (const a of detailLinks) {
              let p = a.parentElement;
              for (let d = 0; d < 8 && p; d++) {
                const t = p.innerText || '';
                if (t.length > 25 && /K|面议|薪/.test(t)) {
                  if (!seenRoots.has(p)) { seenRoots.add(p); cardRoots.push(p); }
                  break;
                }
                p = p.parentElement;
              }
            }
            lines.push(`反查卡片根节点: ${cardRoots.length} 个`);
            const classCount = {};
            cardRoots.forEach(c => {
              const k = c.tagName + '.' + (c.className || '').toString().trim().split(/\s+/).slice(0, 4).join('.');
              classCount[k] = (classCount[k] || 0) + 1;
            });
            Object.entries(classCount).slice(0, 6).forEach(([k, n]) => lines.push(`  根节点画像: ${k} ×${n}`));
            cardRoots.slice(0, 3).forEach((c, i) => {
              const r = c.getBoundingClientRect();
              lines.push(`  [${i}] ${c.tagName} class="${(c.className || '').toString().slice(0, 60)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
            });
            window.__diagCards = cardRoots;
          } catch (e) { lines.push('深度自检① 异常: ' + e.message); }

          lines.push('--- 深度自检② 薪资解析实测（PUA 反爬字体） ---');
          try {
            const cards = window.__diagCards || [];
            if (cards.length === 0) lines.push('  (无卡片，跳过)');
            cards.slice(0, 5).forEach((c, i) => {
              const salEl = c.querySelector('.salary, [class*="salary"]');
              const salText = salEl ? (salEl.innerText || salEl.textContent || '').trim() : '(未找到薪资元素)';
              const hex = salText === '(未找到薪资元素)' ? '' : salText.split('').slice(0, 12).map(ch => '0x' + ch.charCodeAt(0).toString(16)).join(' ');
              const [a1, b1] = parseSalary(salText);
              const fullText = (c.innerText || '').replace(/\n/g, ' ');
              const [a2, b2] = parseSalary(fullText);
              lines.push(`  [${i}] 元素解析=${a1}-${b1} | 全文解析=${a2}-${b2} | 薪资="${salText}"${hex ? ' hex: ' + hex : ''}`);
            });
          } catch (e) { lines.push('深度自检② 异常: ' + e.message); }

          return lines.join('\n');
        }
      });
      const resultText = results[0]?.result || "无结果";
      updateStatus("诊断完成", "idle");
      document.getElementById("diagnoseSection").style.display = "block";
      document.getElementById("diagnoseResult").textContent = resultText;
    } catch (e) {
      updateStatus("诊断失败: " + e.message, "error");
      console.error('[Boss拓客] 诊断失败:', e);
    }
  });

  document.getElementById("btnClearSent").addEventListener("click", async () => {
    const tab = await getCurrentTab();
    if (!tab || !tab.url || !tab.url.includes("zhipin.com")) {
      updateStatus("请先在浏览器中打开Boss直聘", "error");
      return;
    }
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: "clearSent" });
      if (resp && resp.success) {
        updateStatus(`已清空 ${resp.count || 0} 条发送记录`, "idle");
      } else {
        updateStatus("清空失败: " + (resp && resp.error ? resp.error : "未知错误"), "error");
      }
    } catch (e) {
      updateStatus("清空失败: " + e.message, "error");
    }
  });

  document.getElementById("btnRefreshLog").addEventListener("click", async () => {
    const tab = await getCurrentTab();
    if (!tab || !tab.url || !tab.url.includes("zhipin.com")) {
      updateStatus("请先在浏览器中打开Boss直聘", "error");
      return;
    }
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: "getLogs", limit: 100 });
      if (resp && resp.logs) renderLogs(resp.logs);
    } catch (e) {
      updateStatus("读取日志失败: " + e.message, "error");
    }
  });

  document.getElementById("btnCopyLog").addEventListener("click", async () => {
    const tab = await getCurrentTab();
    if (!tab || !tab.url || !tab.url.includes("zhipin.com")) {
      updateStatus("请先在浏览器中打开Boss直聘", "error");
      return;
    }
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: "getLogs", limit: 200 });
      if (resp && resp.logs && resp.logs.length > 0) {
        const text = resp.logs.map(l => `[${l.time}] ${l.msg}`).join("\n");
        await navigator.clipboard.writeText(text);
        updateStatus(`已复制最近 ${resp.logs.length} 条日志`, "idle");
      } else {
        updateStatus("暂无日志可复制", "error");
      }
    } catch (e) {
      updateStatus("复制日志失败: " + e.message, "error");
    }
  });

  document.getElementById("btnTestLlm").addEventListener("click", async () => {
    const resultEl = document.getElementById("llmTestResult");
    resultEl.style.display = "none";
    updateStatus("正在测试 LLM 连通性...", "running");
    try {
      const cfg = readForm();
      if (!cfg.llmApiKey) {
        updateStatus("请先填写 API Key", "error");
        return;
      }
      const baseUrl = (cfg.llmBaseUrl || DEFAULT_CONFIG.llmBaseUrl).replace(/\/$/, '');
      const model = cfg.llmModel || DEFAULT_CONFIG.llmModel;
      let apiType = cfg.llmApiType || DEFAULT_CONFIG.llmApiType;
      if (apiType === 'auto') apiType = 'openai';

      const prompt = '你好，请只输出一个 JSON：{"ok": true}';
      let url, options;
      if (apiType === 'anthropic') {
        url = `${baseUrl}/messages`;
        options = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.llmApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model, max_tokens: 100, messages: [{ role: 'user', content: prompt }] }),
        };
      } else {
        url = `${baseUrl}/chat/completions`;
        const temp = baseUrl.includes('api.kimi.com/coding') ? 1 : 0.3;
        const reqBody = { model, messages: [{ role: 'user', content: prompt }], temperature: temp, max_tokens: 100 };
        // DeepSeek 思考模式默认开启，连通性测试关掉才能快速返回（与 content.js 保持一致）
        if (baseUrl.includes('deepseek.com')) reqBody.thinking = { type: 'disabled' };
        options = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.llmApiKey}` },
          body: JSON.stringify(reqBody),
        };
      }

      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'llmFetch', url, options }, (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(res || {});
        });
      });

      let text = '';
      if (result.ok) {
        text = `✅ HTTP ${result.status} ${result.statusText || ''}\n\n原始响应（前800字）:\n${(result.text || '').slice(0, 800)}`;
        updateStatus("LLM 连通性测试成功", "idle");
      } else {
        text = `❌ 测试失败\n状态: ${result.status || 'N/A'} ${result.statusText || ''}\n错误: ${result.error || '未知错误'}\n\n原始响应（前800字）:\n${(result.text || '').slice(0, 800)}`;
        updateStatus("LLM 连通性测试失败", "error");
      }
      resultEl.textContent = text;
      resultEl.style.display = "block";
    } catch (e) {
      resultEl.textContent = `❌ 测试异常: ${e.message}`;
      resultEl.style.display = "block";
      updateStatus("LLM 测试异常", "error");
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "status") updateStatus(msg.text, msg.type || "idle");
    if (msg.action === "stats") updateStats(msg.stats);
    if (msg.action === "stopped") setButtons(false);
    if (msg.action === "logs") renderLogs(msg.logs);
  });
});
