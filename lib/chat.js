'use strict';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
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

  // 属性惩罚提示
  const rawAlloc = state.rawAlloc || {};
  const debuffs = [];
  if ((rawAlloc.mind || 0) < 2) debuffs.push('【心态极低】玩家处于恐慌状态，容易做出非理性决策，亏损会被放大');
  else if ((rawAlloc.mind || 0) < 4) debuffs.push('【心态偏低】玩家心理承受力不足，遇到波动容易动摇');
  if ((rawAlloc.know || 0) < 2) debuffs.push('【认知极低】玩家完全无法识别骗局，选项中的陷阱不要给任何风险暗示，让玩家自己踩坑');
  else if ((rawAlloc.know || 0) < 4) debuffs.push('【认知偏低】玩家对风险判断力不足，骗局选项的风险暗示应该很隐晦');
  if ((rawAlloc.luck || 0) < 2) debuffs.push('【气运极低】几乎不给正面事件，好项目不会出现在选项中');
  else if ((rawAlloc.luck || 0) < 4) debuffs.push('【气运偏低】正面事件概率降低，偶尔才有好机会');
  // 低本金原始积累提示
  if ((rawAlloc.money || 0) <= 4 && (state.turn || 0) < 8) {
    debuffs.push('【低本金开局】玩家起步资金很少，前期应安排一些原始积累机会：打工攒钱、薅空投、做任务赚U等草根剧情，帮助玩家快速完成原始积累，money效果可以给较大正百分比（+50~+100）让资产快速增长');
  }
  const debuffCtx = debuffs.length ? '\n属性状态：\n' + debuffs.join('\n') : '';

  // 格式化当前资产
  const assetStr = state.money > 1e12 ? '¥'+Math.round(state.money/1e12)+'万亿' :
    state.money > 1e8 ? '¥'+Math.round(state.money/1e8)+'亿' :
    state.money > 1e4 ? '¥'+Math.round(state.money/1e4)+'万' : '¥'+state.money;

  let base = `你是一款沉浸式中文币圈题材文字冒险游戏的叙事引擎，世界观是「修真=炒币」，风格犀利幽默，充满币圈黑话和真实梗。
${charCtx}
${traitCtx}
当前境界：${realm.name}（${realm.sub}），当前总资产：${assetStr}
玩家属性：心态=${state.mind || 0}，认知=${state.know || 0}，气运=${state.luck || 0}，回合=${state.turn || 0}
持仓：${Array.isArray(state.inv) && state.inv.length ? state.inv.join('、') : '空仓'}
${debuffCtx}

请严格遵守返回结构：
1. story 用简体中文，150字内，延续上一段剧情，体现人物口吻，句子必须写完整不能截断。
2. choices 固定给3个选项，每个12字内，不要带编号。
3. effects.money 是百分比变化（整数），正数=盈利，负数=亏损。范围 -50 到 100（即 -50%跌 到 +100%翻倍）。mind/know 在 -20 到 20，luck 在 -15 到 15。注意：story 中提到的具体金额必须与当前总资产 ${assetStr} 的百分比对应。例如当前资产600万，money=+10 意味着赚了60万，不要在剧情里写成赚了几千块。
4. 没有物品变化时 item 和 lose_item 必须为 null。
5. money 达到下一境界门槛 ${nextRealm.asset} 时 breakthrough 可为 true，否则通常为 false。
6. 根据玩家属性状态调整选项难度和陷阱密度。认知低的玩家应该更容易遇到伪装成机会的骗局。`;

  if (retryNote) {
    base += `\n7. ${retryNote}`;
  }

  return `${base}
8. 每回合只推进一个眼前场景，不要写成教程、设定集、目录、长篇总结、著书立说、数年后回顾。
9. story 禁止出现 Markdown 标题、代码块、列表、表格、JSON 示例说明。
10. choices 必须是正常中文操作选项，不能是单个字母、拼音残片、乱码或占位文本。`;
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('missing_api_key');
    err.statusCode = 500;
    err.exposeMessage = '服务端未配置 ANTHROPIC_API_KEY。';
    throw err;
  }

  let lastNormalized = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        temperature: 0.5,
        system: buildSystemPrompt(
          state,
          attempt === 1 ? '上一轮输出不合规。请收束成一个短场景，并返回三个明确、自然、正常的中文操作选项。' : ''
        ),
        messages: [...formatHistory(histSnap), { role: 'user', content: userMsg }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: OUTPUT_SCHEMA
          }
        }
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
    if (data.stop_reason === 'refusal') {
      const err = new Error('模型拒绝了本次生成请求。');
      err.statusCode = 502;
      err.exposeMessage = err.message;
      throw err;
    }
    if (data.stop_reason === 'max_tokens') {
      lastNormalized = {
        story: '市场噪音太大，这一念未能推演完整。',
        choices: [...FALLBACK_CHOICES],
        effects: { money: 0, mind: 0, know: 0, luck: 0, item: null, lose_item: null, breakthrough: false }
      };
      continue;
    }

    const text = Array.isArray(data.content)
      ? data.content.filter((item) => item.type === 'text').map((item) => item.text).join('')
      : '';
    const normalized = normalizeResult(parseResult(text));
    lastNormalized = normalized;

    if (isUsableResult(normalized)) {
      return {
        ...normalized,
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0
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
