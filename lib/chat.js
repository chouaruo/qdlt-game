'use strict';

const MODEL = process.env.AI_MODEL || 'qwen3.5-plus';
const API_BASE = process.env.AI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
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
  { code: 'A0', name: '凡人', sub: '入世凡尘', asset: '负债', assetNum: 0 },
  { code: 'A1', name: '练气初期', sub: '感应灵气', asset: '¥1', assetNum: 1 },
  { code: 'A2', name: '练气中期', sub: '吐纳灵气', asset: '¥10', assetNum: 10 },
  { code: 'A3', name: '练气后期', sub: '凝练灵气', asset: '¥100', assetNum: 100 },
  { code: 'A4', name: '筑基初期', sub: '夯实根基', asset: '¥1,000', assetNum: 1000 },
  { code: 'A5', name: '筑基中期', sub: '根基稳固', asset: '¥1万', assetNum: 10000 },
  { code: 'A6', name: '筑基后期', sub: '厚积待发', asset: '¥10万', assetNum: 100000 },
  { code: 'A7', name: '金丹初期', sub: '丹成一转', asset: '¥100万', assetNum: 1000000 },
  { code: 'A8', name: '金丹中期', sub: '丹成三转', asset: '¥1,000万', assetNum: 10000000 },
  { code: 'A9', name: '金丹后期', sub: '丹成九转', asset: '¥1亿', assetNum: 100000000 },
  { code: 'A10', name: '元婴初期', sub: '神识初成', asset: '¥10亿', assetNum: 1000000000 },
  { code: 'A11', name: '元婴中期', sub: '婴体稳固', asset: '¥100亿', assetNum: 10000000000 },
  { code: 'A12', name: '元婴后期', sub: '婴变通玄', asset: '¥1,000亿', assetNum: 100000000000 },
  { code: 'A13', name: '化神初期', sub: '神游万界', asset: '¥1万亿', assetNum: 1000000000000 },
  { code: 'A14', name: '化神中期', sub: '法则加身', asset: '¥10万亿', assetNum: 10000000000000 },
  { code: 'A15', name: '化神后期', sub: '半步飞升', asset: '¥100万亿', assetNum: 100000000000000 }
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

  let base = `币圈文字冒险叙事引擎。修真=炒币，风格犀利幽默，币圈黑话+真实梗。
${charCtx}${traitCtx?'\n'+traitCtx:''}
境界：${realm.name}，资产：${assetStr}，心态${state.mind||0}/认知${state.know||0}/气运${state.luck||0}，回合${state.turn||0}/30
持仓：${Array.isArray(state.inv)&&state.inv.length?state.inv.join('、'):'空仓'}${debuffCtx}${(state.turn||0)>=25?'\n【最后冲刺】还剩'+(30-(state.turn||0))+'回合，剧情应体现紧迫感和最终抉择的氛围':''}

规则：
1.story简中≤150字，完整句子，延续剧情，体现人物口吻。禁止写任何具体金额数字，用定性描述代替（如"赚了一笔""亏了不少""翻了一倍""账户缩水严重"），具体数字由UI展示。
2.choices固定3个≤12字中文，不带编号。
3.effects.money百分比整数(-50~100)，mind/know±20，luck±15。无物品变化item/lose_item=null。达${nextRealm.asset}可breakthrough=true。
4.低认知多伪装骗局。每回合一个场景，禁教程/设定集/目录/总结。
5.story禁Markdown(标题/代码块/列表/表格)，全中文不夹英文（币圈专有名词BTC/ETH/USDT/DeFi等除外）。choices须正常中文操作选项。`;

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
    story: String(result.story || '').replace(/\s+/g, ' ').trim(),
    choices: Array.isArray(result.choices) ? result.choices.map((item) => String(item || '').trim()) : [],
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
  normalized.effects.mind = Math.max(-20, Math.min(20, normalized.effects.mind));
  normalized.effects.know = Math.max(-20, Math.min(20, normalized.effects.know));
  normalized.effects.luck = Math.max(-15, Math.min(15, normalized.effects.luck));
  normalized.choices = normalized.choices.filter((choice, index, arr) => isValidChoice(choice) && arr.indexOf(choice) === index);

  return normalized;
}

function isUsableResult(result) {
  return !isMetaStory(result.story) && result.choices.length === 3;
}

async function generateGameTurn({ userMsg, histSnap, state }) {
  const apiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('missing_api_key');
    err.statusCode = 500;
    err.exposeMessage = '服务端未配置 AI_API_KEY。';
    throw err;
  }

  let lastNormalized = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sysPrompt = buildSystemPrompt(
      state,
      attempt === 1 ? '上一轮输出不合规。请收束成一个短场景，并返回三个明确、自然、正常的中文操作选项。' : ''
    );
    const messages = [
      { role: 'system', content: sysPrompt },
      ...formatHistory(histSnap),
      { role: 'user', content: userMsg }
    ];

    const response = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        temperature: 0.5,
        messages,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      let detail = '调用失败';
      try {
        const data = await response.json();
        detail = data.error?.message || detail;
      } catch (_) {}
      const err = new Error(detail);
      err.statusCode = response.status;
      err.exposeMessage = detail;
      throw err;
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      lastNormalized = {
        story: '市场噪音太大，这一念未能推演完整。',
        choices: [...FALLBACK_CHOICES],
        effects: { money: 0, mind: 0, know: 0, luck: 0, item: null, lose_item: null, breakthrough: false }
      };
      continue;
    }

    const text = choice?.message?.content || '';
    const normalized = normalizeResult(parseResult(text));
    lastNormalized = normalized;

    if (isUsableResult(normalized)) {
      return {
        ...normalized,
        usage: {
          input_tokens: data.usage?.prompt_tokens || 0,
          output_tokens: data.usage?.completion_tokens || 0
        }
      };
    }
  }

  return {
    story: lastNormalized?.story && !isMetaStory(lastNormalized.story)
      ? lastNormalized.story
      : '市场杂音太重，你只捕捉到几缕残缺信号，先稳住仓位再推演下一步。',
    choices: lastNormalized?.choices?.length === 3 ? lastNormalized.choices : [...FALLBACK_CHOICES],
    effects: lastNormalized?.effects || {
      money: 0,
      mind: 0,
      know: 0,
      luck: 0,
      item: null,
      lose_item: null,
      breakthrough: false
    },
    usage: {
      input_tokens: 0,
      output_tokens: 0
    }
  };
}

module.exports = { generateGameTurn };
