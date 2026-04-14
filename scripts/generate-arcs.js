'use strict';
const fs = require('fs');
const path = require('path');

// 手动加载 .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const API_KEY = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'story-arcs.json');
const SLEEP_MS = 1500;
const STORIES_PER_PHASE = 10;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 16个角色的详细信息
const CHARS = {
  '散户': { desc: '普通散户李狗蛋，打工人入币圈', style: '草根视角，接地气，充满自嘲' },
  'CZ': { desc: '赵长鹏，从OKCoin离职创立币安', style: '交易所创业者视角，商业决策，全球扩张' },
  'SBF': { desc: 'SBF，Jane Street离职，创立Alameda和FTX', style: '量化交易+有效利他主义，精英但危险' },
  '宝二爷': { desc: '郭宏才，卖牛肉起家，内蒙矿场，布道师', style: '豪放粗犷，直播风格，永远看多' },
  '徐明星': { desc: '徐明星，人大物理系，豆丁网→OKCoin→OKX', style: '技术出身，交易所运营，风波不断' },
  '孙宇晨': { desc: '孙宇晨，北大宾大，波场创始人，营销天才', style: '极度自信，画饼能力强，话题制造机' },
  'DoKwon': { desc: 'Do Kwon，斯坦福毕业，Terra/LUNA创始人', style: '算法信仰者，数学狂人，从巅峰到崩盘' },
  '木头姐': { desc: 'Cathie Wood，ARK基金创始人', style: '逆势投资，信念坚定，预测BTC百万美元' },
  'ZachXBT': { desc: 'ZachXBT，匿名链上侦探，揭露骗局', style: '调查记者视角，正义感，链上追踪' },
  'Brian': { desc: 'Brian Armstrong，Airbnb工程师→Coinbase创始人', style: '合规路线，硅谷创业者，和监管博弈' },
  'Arthur': { desc: 'Arthur Hayes，花旗银行→BitMEX创始人', style: '宏观分析，高杠杆，从顶级到被起诉再回归' },
  'Saylor': { desc: 'Michael Saylor，MicroStrategy CEO', style: '比特币极端信仰者，永不卖出，公司全仓BTC' },
  'HeYi': { desc: '何一，旅游卫视主持人→OKCoin CMO→币安联创', style: '用户增长专家，流量思维，社区运营' },
  '吴忌寒': { desc: '吴忌寒，翻译BTC白皮书，比特大陆创始人', style: '矿圈视角，算力战争，周期判断' },
  'V神': { desc: 'Vitalik Buterin，19岁创以太坊', style: '技术理想主义，去中心化信仰，不在乎钱' },
  '中本聪': { desc: '中本聪，比特币创造者，身份成谜', style: '神秘，哲学性，超脱世俗，观察者视角' },
};

// 5个阶段的描述
const PHASES = {
  early:  { name: '早期', turns: '2-5',  desc: '刚入场或刚起步，资金少，学习基础，犯新手错误，建立认知' },
  growth: { name: '成长期', turns: '7-11', desc: '开始有经验，初步盈利，扩大规模，遇到第一次挫折' },
  boom:   { name: '爆发期', turns: '13-17', desc: '行业爆发，大机会大风险，重大决策，开始有影响力' },
  climax: { name: '高潮期', turns: '19-23', desc: '到达巅峰或面临最大危机，行业级事件，命运转折' },
  final:  { name: '终局期', turns: '25-29', desc: '尘埃落定，反思总结，最后的抉择，为结局铺垫' },
};

const TAGS = ['交易','挖矿','DeFi','NFT','社区','调查','合规','营销','技术','投资','牛市','熊市','震荡','社交','KOL','机构'];

async function generatePhaseStories(charId, charInfo, phaseId, phaseInfo) {
  const prompt = `你是币圈文字冒险游戏的剧情编剧。为以下角色生成${STORIES_PER_PHASE}段不同的剧情。

角色：${charInfo.desc}
风格：${charInfo.style}
当前阶段：${phaseInfo.name}（游戏回合${phaseInfo.turns}）—— ${phaseInfo.desc}

要求：
1. 每段剧情(story) 100-150字，简体中文，犀利幽默，充满币圈黑话和真实梗
2. 禁止写任何具体金额数字，用定性描述（"赚了一笔""亏了不少"）
3. 每段配3个选项(choices)，每个≤12字
4. 每个选项配一组效果(effects)：money为百分比(-50到100)，mind/know/luck为绝对值(±20)
5. 10段剧情要多样化，覆盖不同场景（交易/社交/学习/风险事件等）
6. 体现角色的独特口吻和经历特点
7. 每段剧情附带1-3个标签(tags)，从以下选择：${TAGS.join('、')}
8. 全中文不夹英文（BTC/ETH/DeFi/NFT等币圈专有名词除外）

返回严格JSON数组，每个元素格式：
{
  "tags": ["交易", "牛市"],
  "story": "剧情文本...",
  "choices": ["选项1", "选项2", "选项3"],
  "effects": [
    {"money":0,"mind":0,"know":0,"luck":0,"item":null,"lose_item":null,"breakthrough":false},
    {"money":0,"mind":0,"know":0,"luck":0,"item":null,"lose_item":null,"breakthrough":false},
    {"money":0,"mind":0,"know":0,"luck":0,"item":null,"lose_item":null,"breakthrough":false}
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      temperature: 0.9,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.content?.map(c => c.text).join('') || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found');

  const items = JSON.parse(match[0]);
  return items.map((item, i) => ({
    id: `${charId}_${phaseId}_${String(i).padStart(2,'0')}`,
    tags: Array.isArray(item.tags) ? item.tags : [],
    story: String(item.story || '').trim(),
    choices: Array.isArray(item.choices) ? item.choices.map(c => String(c).trim()).slice(0, 3) : [],
    effects: Array.isArray(item.effects) ? item.effects.slice(0, 3).map(fx => ({
      money: Math.max(-50, Math.min(100, Number(fx.money) || 0)),
      mind: Math.max(-20, Math.min(20, Number(fx.mind) || 0)),
      know: Math.max(-20, Math.min(20, Number(fx.know) || 0)),
      luck: Math.max(-15, Math.min(15, Number(fx.luck) || 0)),
      item: fx.item || null,
      lose_item: fx.lose_item || null,
      breakthrough: Boolean(fx.breakthrough),
    })) : [],
  })).filter(s => s.story.length >= 20 && s.choices.length === 3 && s.effects.length === 3);
}

async function main() {
  console.log('=== 角色剧情弧线生成器 ===\n');

  // 加载已有数据（断点续传）
  let arcs = { characters: {} };
  if (fs.existsSync(OUTPUT_FILE)) {
    arcs = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    console.log(`已有数据，断点续传\n`);
  }

  let totalGenerated = 0;
  const charIds = Object.keys(CHARS);
  const phaseIds = Object.keys(PHASES);

  for (const charId of charIds) {
    if (!arcs.characters[charId]) {
      arcs.characters[charId] = { phases: {} };
    }
    const charArc = arcs.characters[charId];

    for (const phaseId of phaseIds) {
      // 检查是否已有足够的故事
      const existing = charArc.phases[phaseId]?.stories?.length || 0;
      if (existing >= STORIES_PER_PHASE) {
        console.log(`  ✓ ${charId} × ${phaseId}: 已有 ${existing} 条，跳过`);
        continue;
      }

      console.log(`  → ${charId} × ${phaseId}: 生成中...`);
      try {
        const stories = await generatePhaseStories(charId, CHARS[charId], phaseId, PHASES[phaseId]);
        charArc.phases[phaseId] = { stories };
        totalGenerated += stories.length;
        console.log(`    +${stories.length} 条（总计已生成 ${totalGenerated}）`);

        // 每次保存
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(arcs, null, 2), 'utf-8');
        await sleep(SLEEP_MS);
      } catch (err) {
        console.error(`    ✗ 失败: ${err.message}`);
        await sleep(3000);
      }
    }
  }

  // 统计
  let total = 0;
  for (const cid of Object.keys(arcs.characters)) {
    for (const pid of Object.keys(arcs.characters[cid].phases || {})) {
      total += arcs.characters[cid].phases[pid]?.stories?.length || 0;
    }
  }
  console.log(`\n=== 完成！共 ${total} 条阶段池故事，本次新增 ${totalGenerated} ===`);
  if (fs.existsSync(OUTPUT_FILE)) {
    console.log(`文件: ${OUTPUT_FILE}`);
    console.log(`大小: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
  }
}

main().catch(console.error);
