export const config = { runtime: 'edge' };

const MODEL = process.env.AI_MODEL || 'qwen3.5-plus';
const API_BASE = process.env.AI_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const FALLBACK_CHOICES = ['持仓等待', '分析链上', '联系律师'];

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    story: { type: 'string', minLength: 20, maxLength: 300 },
    choices: { type: 'array', items: { type: 'string', minLength: 2, maxLength: 12 } },
    effects: {
      type: 'object',
      properties: {
        money: { type: 'integer' }, mind: { type: 'integer' },
        know: { type: 'integer' }, luck: { type: 'integer' },
        item: { type: ['string', 'null'] }, lose_item: { type: ['string', 'null'] },
        breakthrough: { type: 'boolean' }
      },
      required: ['money', 'mind', 'know', 'luck', 'item', 'lose_item', 'breakthrough'],
      additionalProperties: false
    }
  },
  required: ['story', 'choices', 'effects'],
  additionalProperties: false
};

const REALMS = [
  { code:'A0', name:'凡人', asset:'负债' },
  { code:'A1', name:'练气初期', asset:'¥1' },
  { code:'A2', name:'练气中期', asset:'¥10' },
  { code:'A3', name:'练气后期', asset:'¥100' },
  { code:'A4', name:'筑基初期', asset:'¥1,000' },
  { code:'A5', name:'筑基中期', asset:'¥1万' },
  { code:'A6', name:'筑基后期', asset:'¥10万' },
  { code:'A7', name:'金丹初期', asset:'¥100万' },
  { code:'A8', name:'金丹中期', asset:'¥1,000万' },
  { code:'A9', name:'金丹后期', asset:'¥1亿' },
  { code:'A10', name:'元婴初期', asset:'¥10亿' },
  { code:'A11', name:'元婴中期', asset:'¥100亿' },
  { code:'A12', name:'元婴后期', asset:'¥1,000亿' },
  { code:'A13', name:'化神初期', asset:'¥1万亿' },
  { code:'A14', name:'化神中期', asset:'¥10万亿' },
  { code:'A15', name:'化神后期', asset:'¥100万亿' },
];

function buildSystemPrompt(state) {
  const realm = REALMS[state.realmIdx] || REALMS[0];
  const nextRealm = REALMS[Math.min((state.realmIdx||0)+1, REALMS.length-1)];
  const charCtx = state.char ? `玩家扮演：${state.char.aiTag}` : '玩家是普通散户';
  const traitCtx = Array.isArray(state.traits) && state.traits.length
    ? `开局词条：${state.traits.map(t => `${t.name}（${String(t.desc||'').slice(0,20)}）`).join('，')}` : '';

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

  const m = state.money||0;
  const assetStr = m>1e12?'¥'+Math.round(m/1e12)+'万亿':m>1e8?'¥'+Math.round(m/1e8)+'亿':m>1e4?'¥'+Math.round(m/1e4)+'万':'¥'+m;

  return `币圈文字冒险叙事引擎。修真=炒币，风格犀利幽默，币圈黑话+真实梗。
${charCtx}${traitCtx?'\n'+traitCtx:''}
境界：${realm.name}，资产：${assetStr}，心态${state.mind||0}/认知${state.know||0}/气运${state.luck||0}，回合${state.turn||0}/30
持仓：${Array.isArray(state.inv)&&state.inv.length?state.inv.join('、'):'空仓'}${debuffCtx}${(state.turn||0)>=25?'\n【最后冲刺】还剩'+(30-(state.turn||0))+'回合，剧情应体现紧迫感和最终抉择的氛围':''}

规则：
1.story简中≤150字，完整句子，延续剧情，体现人物口吻。禁止写任何具体金额数字，用定性描述代替（如"赚了一笔""亏了不少""翻了一倍""账户缩水严重"），具体数字由UI展示。
2.choices固定3个≤12字中文，不带编号。
3.effects.money百分比整数(-50~100)，mind/know±20，luck±15。无物品变化item/lose_item=null。达${nextRealm.asset}可breakthrough=true。
4.低认知多伪装骗局。每回合一个场景，禁教程/设定集/目录/总结。
5.story禁Markdown(标题/代码块/列表/表格)，全中文不夹英文（币圈专有名词BTC/ETH/USDT/DeFi等除外）。choices须正常中文操作选项。`;
}

function formatHistory(histSnap) {
  return (Array.isArray(histSnap) ? histSnap : []).map(entry => {
    if (entry.role !== 'assistant' || typeof entry.content !== 'string') return entry;
    try {
      const p = JSON.parse(entry.content);
      const story = String(p.story||'').replace(/\s+/g,' ').trim();
      const fx = [];
      if (p.effects?.money) fx.push(`本金${p.effects.money>0?'+':''}${p.effects.money}`);
      if (p.effects?.mind) fx.push(`心态${p.effects.mind>0?'+':''}${p.effects.mind}`);
      if (p.effects?.know) fx.push(`认知${p.effects.know>0?'+':''}${p.effects.know}`);
      if (p.effects?.luck) fx.push(`气运${p.effects.luck>0?'+':''}${p.effects.luck}`);
      const choices = Array.isArray(p.choices)?p.choices.slice(0,3).join('、'):'';
      return { role:'assistant', content:`剧情：${story}\n结果：${fx.join('，')||'无'}\n备选：${choices||'无'}` };
    } catch(_) {
      return { role:'assistant', content: String(entry.content).replace(/\s+/g,' ').slice(0,220) };
    }
  });
}

function hasCjk(t){return /[\u3400-\u9fff]/.test(String(t));}
function isValidChoice(c){const v=String(c||'').trim();return v.length>=2&&v.length<=12&&!/^[A-Za-z0-9 _-]+$/.test(v)&&hasCjk(v);}

function normalizeResult(result) {
  const n = {
    story: String(result.story||'').replace(/\s+/g,' ').trim(),
    choices: Array.isArray(result.choices)?result.choices.map(i=>String(i||'').trim()):[],
    effects: {
      money: Number.isInteger(result.effects?.money)?result.effects.money:0,
      mind: Number.isInteger(result.effects?.mind)?result.effects.mind:0,
      know: Number.isInteger(result.effects?.know)?result.effects.know:0,
      luck: Number.isInteger(result.effects?.luck)?result.effects.luck:0,
      item: typeof result.effects?.item==='string'&&result.effects.item.trim()?result.effects.item.trim():null,
      lose_item: typeof result.effects?.lose_item==='string'&&result.effects.lose_item.trim()?result.effects.lose_item.trim():null,
      breakthrough: Boolean(result.effects?.breakthrough)
    }
  };
  n.effects.money=Math.max(-50,Math.min(100,n.effects.money));
  n.effects.mind=Math.max(-20,Math.min(20,n.effects.mind));
  n.effects.know=Math.max(-20,Math.min(20,n.effects.know));
  n.effects.luck=Math.max(-15,Math.min(15,n.effects.luck));
  n.choices=n.choices.filter((c,i,a)=>isValidChoice(c)&&a.indexOf(c)===i);
  return n;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return new Response(JSON.stringify({error:'Method not allowed'}), { status: 405, headers: corsHeaders() });

  const apiKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response(JSON.stringify({error:'未配置API Key'}), { status: 500, headers: corsHeaders() });

  const { userMsg, histSnap, state } = await req.json();

  const sysPrompt = buildSystemPrompt(state);
  const messages = [
    { role: 'system', content: sysPrompt },
    ...formatHistory(histSnap),
    { role: 'user', content: userMsg }
  ];

  const anthropicRes = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      temperature: 0.5,
      stream: true,
      messages,
      response_format: { type: 'json_object' }
    })
  });

  if (!anthropicRes.ok) {
    const detail = await anthropicRes.text().catch(()=>'API error');
    return new Response(JSON.stringify({error:detail}), { status: anthropicRes.status, headers: corsHeaders() });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullText = '';
      let usage = { input_tokens: 0, output_tokens: 0 };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            let evt;
            try { evt = JSON.parse(raw); } catch(_) { continue; }

            // OpenAI 兼容格式：choices[0].delta.content
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'delta',text:delta})}\n\n`));
            }
            // usage 在最后一条消息中
            if (evt.usage) {
              usage.input_tokens = evt.usage.prompt_tokens || 0;
              usage.output_tokens = evt.usage.completion_tokens || 0;
            }
          }
        }
      } catch(e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'error',message:e.message})}\n\n`));
      }

      // Parse and normalize final result
      let result;
      try { result = normalizeResult(JSON.parse(fullText)); }
      catch(_) { result = { story: fullText || '信号中断', choices: [...FALLBACK_CHOICES], effects: {money:0,mind:0,know:0,luck:0,item:null,lose_item:null,breakthrough:false} }; }
      if (result.choices.length !== 3) result.choices = [...FALLBACK_CHOICES];

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({type:'done',result,usage})}\n\n`));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
  });
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}
