'use strict';

// 支持多 provider：Anthropic（默认）/ OpenAI 兼容（Qwen等）
const PROVIDER = process.env.AI_PROVIDER || 'anthropic'; // 'anthropic' or 'openai'
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const API_BASE = process.env.AI_API_BASE || 'https://api.anthropic.com';
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    story: { type: 'string', minLength: 20, maxLength: 300 },
    choices: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 2,
        maxLength: 12
      }
    },
    effects: {
      type: 'object',
      properties: {
        money: { type: 'integer' },
        mind: { type: 'integer' },
        know: { type: 'integer' },
        luck: { type: 'integer' },
        item: { type: ['string', 'null'] },
        lose_item: { type: ['string', 'null'] },
        breakthrough: { type: 'boolean' }
      },
      required: ['money', 'mind', 'know', 'luck', 'item', 'lose_item', 'breakthrough'],
      additionalProperties: false
    }
  },
  required: ['story', 'choices', 'effects'],
  additionalProperties: false
};

const FALLBACK_CHOICES = ['持仓等待', '分析链上', '联系律师'];

const REALMS = [
  { code: 'LV0', name: '负债韭菜', sub: '欠债入场', asset: '负债', assetNum: 0 },
  { code: 'LV1', name: '注册新手', sub: '刚开户', asset: '¥1', assetNum: 1 },
  { code: 'LV2', name: '小额玩家', sub: '试试水', asset: '¥10', assetNum: 10 },
  { code: 'LV3', name: '入门散户', sub: '开始学习', asset: '¥100', assetNum: 100 },
  { code: 'LV4', name: '普通散户', sub: '有点经验', asset: '¥1,000', assetNum: 1000 },
  { code: 'LV5', name: '资深散户', sub: '见过牛熊', asset: '¥1万', assetNum: 10000 },
  { code: 'LV6', name: '小额投资者', sub: '初具规模', asset: '¥10万', assetNum: 100000 },
  { code: 'LV7', name: '百万玩家', sub: '财务起步', asset: '¥100万', assetNum: 1000000 },
  { code: 'LV8', name: '千万大户', sub: '圈内有名', asset: '¥1,000万', assetNum: 10000000 },
  { code: 'LV9', name: '亿级巨鲸', sub: '呼风唤雨', asset: '¥1亿', assetNum: 100000000 },
  { code: 'LV10', name: '十亿大佬', sub: '机构级别', asset: '¥10亿', assetNum: 1000000000 },
  { code: 'LV11', name: '百亿巨擘', sub: '行业领袖', asset: '¥100亿', assetNum: 10000000000 },
  { code: 'LV12', name: '千亿寡头', sub: '富可敌国', asset: '¥1,000亿', assetNum: 100000000000 },
  { code: 'LV13', name: '万亿传说', sub: '改变行业', asset: '¥1万亿', assetNum: 1000000000000 },
  { code: 'LV14', name: '十万亿神话', sub: '载入史册', asset: '¥10万亿', assetNum: 10000000000000 },
  { code: 'LV15', name: '百万亿创世', sub: '超越一切', asset: '¥100万亿', assetNum: 100000000000000 }
];

function buildSystemPrompt(state, retryNote = '') {
  const realm = REALMS[state.realmIdx] || REALMS[0];
  const nextRealm = REALMS[Math.min((state.realmIdx || 0) + 1, REALMS.length - 1)];
  const charCtx = state.char ? `玩家扮演：${state.char.aiTag}` : '玩家是普通散户';
  const traitCtx = Array.isArray(state.traits) && state.traits.length
    ? `开局词条：${state.traits.map((t) => `${t.name}（${String(t.desc || '').slice(0, 20)}）`).join('，')}`
    : '';

  // 属性状态标签
  const rawAlloc = state.rawAlloc || {};
  const debuffs = [];
  if ((rawAlloc.mind||0)<2) debuffs.push('【心态极低】恐慌态，陷阱选项不暗示风险');
  else if ((rawAlloc.mind||0)<4) debuffs.push('【心态偏低】易动摇');
  if ((rawAlloc.know||0)<2) debuffs.push('【认知极低】无法识骗，骗局不给暗示');
  else if ((rawAlloc.know||0)<4) debuffs.push('【认知偏低】风险暗示需隐晦');
  if ((rawAlloc.luck||0)<2) debuffs.push('【气运极低】不给正面事件');
  else if ((rawAlloc.luck||0)<4) debuffs.push('【气运偏低】好事减半');
  if ((rawAlloc.money||0)<=4&&(state.turn||0)<8) debuffs.push('【低本金】前期多给原始积累机会，money可+50~+100');
  const debuffCtx = debuffs.length ? '\n状态：'+debuffs.join('；') : '';

  const assetStr = state.money > 1e12 ? '¥'+Math.round(state.money/1e12)+'万亿' :
    state.money > 1e8 ? '¥'+Math.round(state.money/1e8)+'亿' :
    state.money > 1e4 ? '¥'+Math.round(state.money/1e4)+'万' : '¥'+state.money;

  let base = `币圈文字冒险叙事引擎。风格犀利幽默，币圈黑话+真实梗。请返回json格式。
${charCtx}${traitCtx?'\n'+traitCtx:''}
等级：${realm.name}，资产：${assetStr}，心态${state.mind||0}/认知${state.know||0}/气运${state.luck||0}，回合${state.turn||0}/30
持仓：${Array.isArray(state.inv)&&state.inv.length?state.inv.join('、'):'空仓'}${debuffCtx}${(state.turn||0)>=25?'\n【最后冲刺】还剩'+(30-(state.turn||0))+'回合，剧情应体现紧迫感和最终抉择的氛围':''}

规则：
1.story简中≤150字，完整句子，延续剧情，体现人物口吻。禁止写任何具体金额数字，用定性描述代替（如"赚了一笔""亏了不少""翻了一倍""账户缩水严重"），具体数字由UI展示。
2.choices固定3个≤12字中文，不带编号。
3.effects.money百分比整数(-50~100)，mind/know±15，luck±10。无物品变化item/lose_item=null。达${nextRealm.asset}可breakthrough=true。属性变化时story必须写明原因（如心态扣减"看到血崩K线心态崩了"、认知变化"研究白皮书有了新认知"、气运变化"赶上了空投季"），不得无故扣减任何属性。
4.低认知多伪装骗局。每回合一个场景，禁教程/设定集/目录/总结。
5.story禁Markdown(标题/代码块/列表/表格)，全中文不夹英文（币圈专有名词BTC/ETH/USDT/DeFi等除外）。story必须语句通顺，无语病，无残句。choices须正常中文操作选项。`;

  if (retryNote) base += `\n6.${retryNote}`;
  return base;
}

function parseResult(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return {
      story: '链上信号紊乱，稍后再试。',
      choices: ['持仓等待', '分析链上', '联系律师'],
      effects: {}
    };
  }
}

function summarizeEffects(effects) {
  const fx = [];
  if (effects.money) fx.push(`本金${effects.money > 0 ? '+' : ''}${effects.money}`);
  if (effects.mind) fx.push(`心态${effects.mind > 0 ? '+' : ''}${effects.mind}`);
  if (effects.know) fx.push(`认知${effects.know > 0 ? '+' : ''}${effects.know}`);
  if (effects.luck) fx.push(`气运${effects.luck > 0 ? '+' : ''}${effects.luck}`);
  if (effects.item) fx.push(`获得${effects.item}`);
  if (effects.lose_item) fx.push(`失去${effects.lose_item}`);
  return fx.length ? fx.join('，') : '无明显变化';
}

function formatHistory(histSnap) {
  return (Array.isArray(histSnap) ? histSnap : []).map((entry) => {
    if (entry.role !== 'assistant' || typeof entry.content !== 'string') {
      return entry;
    }

    try {
      const parsed = JSON.parse(entry.content);
      const story = String(parsed.story || '').replace(/\s+/g, ' ').trim();
      const choices = Array.isArray(parsed.choices) ? parsed.choices.slice(0, 3).join('、') : '';
      const effects = summarizeEffects(parsed.effects || {});
      return {
        role: 'assistant',
        content: `剧情：${story}\n结果：${effects}\n备选：${choices || '无'}`
      };
    } catch (_) {
      return {
        role: 'assistant',
        content: String(entry.content).replace(/\s+/g, ' ').slice(0, 220)
      };
    }
  });
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text));
}

function isValidChoice(choice) {
  const value = String(choice || '').trim();
  if (value.length < 2 || value.length > 12) return false;
  if (/^[A-Za-z0-9 _-]+$/.test(value)) return false;
  if (!hasCjk(value)) return false;
  return true;
}

function isMetaStory(story) {
  const text = String(story || '');
  return (
    text.length < 20 ||
    text.length > 300 ||
    /```|#{1,6}\s|^\s*[\-\*\d]+\./m.test(text) ||
    /JSON|表格|教程|第\d+章|系统说明|目录|设定集/.test(text)
  );
}

function normalizeResult(result) {
  const normalized = {
    story: String(result.story || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    choices: Array.isArray(result.choices) ? result.choices.map((item) => String(item || '').trim().slice(0, 20)).slice(0, 3) : [],
    effects: {
      money: Number.isInteger(result.effects?.money) ? result.effects.money : 0,
      mind: Number.isInteger(result.effects?.mind) ? result.effects.mind : 0,
      know: Number.isInteger(result.effects?.know) ? result.effects.know : 0,
      luck: Number.isInteger(result.effects?.luck) ? result.effects.luck : 0,
      item: typeof result.effects?.item === 'string' && result.effects.item.trim() ? result.effects.item.trim() : null,
      lose_item: typeof result.effects?.lose_item === 'string' && result.effects.lose_item.trim() ? result.effects.lose_item.trim() : null,
      breakthrough: Boolean(result.effects?.breakthrough)
    }
  };

  normalized.effects.money = Math.max(-50, Math.min(100, normalized.effects.money)); // percentage: -50% to +100%
  normalized.effects.mind = Math.max(-15, Math.min(15, normalized.effects.mind));
  normalized.effects.know = Math.max(-15, Math.min(15, normalized.effects.know));
  normalized.effects.luck = Math.max(-10, Math.min(10, normalized.effects.luck));
  normalized.choices = normalized.choices.filter((choice, index, arr) => isValidChoice(choice) && arr.indexOf(choice) === index);

  return normalized;
}

function isUsableResult(result) {
  return !isMetaStory(result.story) && result.choices.length === 3;
}

// 构建 API 请求（支持 Anthropic 和 OpenAI 兼容格式）
function buildRequest(provider, model, apiBase, apiKey, sysPrompt, messages) {
  if (provider === 'anthropic') {
    return {
      url: `${apiBase}/v1/messages`,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model, max_tokens: 800, temperature: 0.5,
        system: sysPrompt,
        messages,
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } }
      }
    };
  }
  // OpenAI 兼容（Qwen/DeepSeek 等）
  return {
    url: `${apiBase}/chat/completions`,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: {
      model, max_tokens: 800, temperature: 0.5,
      messages: [{ role: 'system', content: sysPrompt }, ...messages],
      response_format: { type: 'json_object' }
    }
  };
}

// 解析 API 响应
function parseResponse(provider, data) {
  if (provider === 'anthropic') {
    if (data.stop_reason === 'refusal') throw Object.assign(new Error('模型拒绝'), { statusCode: 502 });
    if (data.stop_reason === 'max_tokens') return { truncated: true };
    const text = Array.isArray(data.content) ? data.content.filter(c => c.type === 'text').map(c => c.text).join('') : '';
    return { text, usage: { input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 } };
  }
  // OpenAI 兼容
  const choice = data.choices?.[0];
  if (choice?.finish_reason === 'length') return { truncated: true };
  return { text: choice?.message?.content || '', usage: { input_tokens: data.usage?.prompt_tokens || 0, output_tokens: data.usage?.completion_tokens || 0 } };
}

// BYOK 安全：只允许已知的 API host，防止 SSRF
const ALLOWED_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
  'api.deepseek.com',
  'api.minimax.io',
];
function isAllowedBase(base) {
  try {
    const host = new URL(base).hostname;
    return ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch (_) { return false; }
}

async function generateGameTurn({ userMsg, histSnap, state, byokKey, byokProvider, byokModel, byokBase }) {
  // BYOK 模式：玩家自带 Key（必须提供自己的 key，不能用服务端 key 访问自定义 host）
  const provider = byokProvider || PROVIDER;
  const model = byokModel || MODEL;
  let apiBase = API_BASE;
  let apiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;

  if (byokKey) {
    // BYOK：用户提供了自己的 key，允许自定义 base（但必须在白名单内）
    apiKey = byokKey;
    if (byokBase && isAllowedBase(byokBase)) {
      apiBase = byokBase;
    } else if (byokBase) {
      const err = new Error('不支持的 API 地址');
      err.statusCode = 400;
      err.exposeMessage = '不支持的 API 地址，请使用官方 API 端点';
      throw err;
    }
  }

  if (!apiKey) {
    const err = new Error('missing_api_key');
    err.statusCode = 500;
    err.exposeMessage = '未配置 API Key。';
    throw err;
  }

  // Validate userMsg
  if (typeof userMsg !== 'string' || userMsg.length === 0 || userMsg.length > 500) {
    const err = new Error('invalid_user_message');
    err.statusCode = 400;
    err.exposeMessage = '用户消息无效';
    throw err;
  }

  // Truncate history to prevent token abuse
  const safeHist = Array.isArray(histSnap) ? histSnap.slice(-20) : [];

  let lastNormalized = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sysPrompt = buildSystemPrompt(
      state,
      attempt === 1 ? '上一轮输出不合规。请收束成一个短场景，并返回三个明确、自然、正常的中文操作选项。' : ''
    );
    const req = buildRequest(provider, model, apiBase, apiKey, sysPrompt, formatHistory(safeHist).concat({ role: 'user', content: userMsg }));

    // Fetch with 30s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        console.error('[TIMEOUT] AI API request timed out after 30s');
        const err = new Error('api_timeout');
        err.statusCode = 504;
        err.exposeMessage = 'AI 服务响应超时，请稍后重试';
        throw err;
      }
      throw fetchErr;
    }
    clearTimeout(timeout);

    // Retry on 429 / 5xx
    if (!response.ok) {
      const status = response.status;
      if ((status === 429 || status >= 500) && attempt === 0) {
        console.warn(`[RETRY] AI API returned ${status}, retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      let detail = '调用失败';
      try { const d = await response.json(); detail = d.error?.message || detail; } catch (_) {}
      console.error(`[API_ERROR] status=${status} detail=${detail}`);
      const err = new Error(detail);
      err.statusCode = status;
      err.exposeMessage = '生成失败，请稍后重试';
      throw err;
    }

    const data = await response.json();
    const parsed = parseResponse(provider, data);

    if (parsed.truncated) {
      lastNormalized = {
        story: '市场噪音太大，这一念未能推演完整。',
        choices: [...FALLBACK_CHOICES],
        effects: { money: 0, mind: 0, know: 0, luck: 0, item: null, lose_item: null, breakthrough: false }
      };
      continue;
    }

    const normalized = normalizeResult(parseResult(parsed.text));
    lastNormalized = normalized;

    if (isUsableResult(normalized)) {
      return { ...normalized, usage: parsed.usage };
    }
  }

  return {
    story: lastNormalized?.story && !isMetaStory(lastNormalized.story)
      ? lastNormalized.story
      : '市场杂音太重，你只捕捉到几缕残缺信号，先稳住仓位再推演下一步。',
    choices: lastNormalized?.choices?.length === 3 ? lastNormalized.choices : [...FALLBACK_CHOICES],
    effects: lastNormalized?.effects || { money: 0, mind: 0, know: 0, luck: 0, item: null, lose_item: null, breakthrough: false },
    usage: { input_tokens: 0, output_tokens: 0 }
  };
}

module.exports = { generateGameTurn };
