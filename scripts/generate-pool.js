'use strict';
const fs = require('fs');
const path = require('path');

// 手动加载 .env（不依赖 dotenv）
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  });
}

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'story-pool.json');

// 16 角色 + 通用
const CHARS = [
  { id: '散户', desc: '普通散户李狗蛋，刚入币圈的打工人' },
  { id: 'CZ', desc: '赵长鹏，币安创始人，从OKCoin离职创业' },
  { id: 'SBF', desc: 'SBF，FTX创始人，有效利他主义者，MIT高材生' },
  { id: '宝二爷', desc: '宝二爷郭宏才，内蒙古煤老板，比特币布道师' },
  { id: '徐明星', desc: '徐明星，OKX创始人，程序员出身' },
  { id: '孙宇晨', desc: '孙宇晨，波场创始人，营销天才' },
  { id: 'DoKwon', desc: 'Do Kwon，Terra LUNA创始人，算法稳定币' },
  { id: '木头姐', desc: 'Cathie Wood，ARK基金，永远预测BTC到100万' },
  { id: 'ZachXBT', desc: 'ZachXBT，匿名链上侦探，揭露骗局' },
  { id: 'Brian', desc: 'Brian Armstrong，Coinbase创始人，合规路线' },
  { id: 'Arthur', desc: 'Arthur Hayes，BitMEX创始人，高杠杆交易' },
  { id: 'Saylor', desc: 'Michael Saylor，把公司资产全换成BTC' },
  { id: 'HeYi', desc: '何一，币安联合创始人，擅长社区运营' },
  { id: '吴忌寒', desc: '吴忌寒，矿圈枭雄，矿机矿池算力' },
  { id: 'V神', desc: 'Vitalik Buterin，以太坊创始人，去中心化信仰者' },
  { id: '中本聪', desc: '中本聪，比特币创造者，身份成谜' },
  { id: '*', desc: '通用角色，适用于任何玩家' },
];

const REALM_TIERS = [
  { id: 'rookie', desc: '草根期(A0-A3)：刚入场，资金极少，薅空投打工搬砖，被骗初体验，学习基础知识' },
  { id: 'growth', desc: '成长期(A4-A6)：有了一些本钱，开始接触主流币，学会看K线，参与社区，认识一些圈内人' },
  { id: 'boom', desc: '爆发期(A7-A9)：资产上百万，开始大额操作，杠杆交易，参与项目投资，经历牛熊周期' },
  { id: 'boss', desc: '大佬期(A10-A12)：行业有影响力，和机构打交道，面对监管压力，管理大额资产' },
  { id: 'legend', desc: '传奇期(A13+)：行业顶级人物，一举一动影响市场，面临终极抉择' },
];

const BATCH_SIZE = 5; // 每次生成5条
const TARGET_PER_COMBO = 25; // 每个角色×境界段25条
const SLEEP_MS = 1500; // API调用间隔

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function generateBatch(charInfo, tierInfo, batchNum) {
  const prompt = `你是一个币圈题材文字冒险游戏的剧情生成器。请生成${BATCH_SIZE}段不同的剧情片段。

角色：${charInfo.desc}
当前阶段：${tierInfo.desc}

要求：
1. 每段剧情(story)用简体中文，100-150字，风格犀利幽默，充满币圈黑话和真实梗
2. 禁止写任何具体金额数字，用定性描述（"赚了一笔""亏了不少""翻了一倍"）
3. 每段配3个选项(choices)，每个≤12字中文
4. 每个选项配对应的效果(effects)，money为百分比(-50到100)，mind/know/luck为绝对值(±20)
5. 剧情要符合角色身份和当前阶段的资产规模
6. ${BATCH_SIZE}段剧情之间不要重复，场景和主题要多样化
7. 体现人物口吻和经历特点${charInfo.id === '*' ? '（通用剧情，不要提及具体人物名字）' : ''}

返回严格JSON数组，每个元素格式：
{
  "story": "剧情文本",
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
      model: MODEL,
      max_tokens: 4000,
      temperature: 0.9,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.map(c => c.text).join('') || '';

  // 提取 JSON 数组
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array found in response');

  const items = JSON.parse(match[0]);
  return items.map((item, i) => ({
    id: `${charInfo.id}_${tierInfo.id}_${batchNum * BATCH_SIZE + i}`,
    char: charInfo.id,
    realmTier: tierInfo.id,
    story: String(item.story || '').trim(),
    choices: Array.isArray(item.choices) ? item.choices.map(c => String(c).trim()) : [],
    effects: Array.isArray(item.effects) ? item.effects.map(fx => ({
      money: Math.max(-50, Math.min(100, Number(fx.money) || 0)),
      mind: Math.max(-20, Math.min(20, Number(fx.mind) || 0)),
      know: Math.max(-20, Math.min(20, Number(fx.know) || 0)),
      luck: Math.max(-15, Math.min(15, Number(fx.luck) || 0)),
      item: fx.item || null,
      lose_item: fx.lose_item || null,
      breakthrough: Boolean(fx.breakthrough),
    })) : [],
  })).filter(item => item.story.length >= 20 && item.choices.length === 3 && item.effects.length === 3);
}

async function main() {
  console.log('=== 币圈模拟器剧情池生成器 ===\n');

  // 加载已有数据（支持断点续传）
  let pool = [];
  if (fs.existsSync(OUTPUT_FILE)) {
    pool = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    console.log(`已有 ${pool.length} 条剧情，断点续传\n`);
  }

  const existingIds = new Set(pool.map(p => p.id));
  let totalGenerated = 0;
  const batchesPerCombo = Math.ceil(TARGET_PER_COMBO / BATCH_SIZE);

  for (const char of CHARS) {
    for (const tier of REALM_TIERS) {
      // 统计已有数量
      const existing = pool.filter(p => p.char === char.id && p.realmTier === tier.id).length;
      if (existing >= TARGET_PER_COMBO) {
        console.log(`  ✓ ${char.id} × ${tier.id}: 已有 ${existing} 条，跳过`);
        continue;
      }

      const needed = TARGET_PER_COMBO - existing;
      const batches = Math.ceil(needed / BATCH_SIZE);
      console.log(`  → ${char.id} × ${tier.id}: 需要 ${needed} 条（${batches} 批）`);

      for (let b = 0; b < batches; b++) {
        const batchNum = Math.floor(existing / BATCH_SIZE) + b;
        try {
          const items = await generateBatch(char, tier, batchNum);
          // 去重
          const newItems = items.filter(item => !existingIds.has(item.id));
          pool.push(...newItems);
          newItems.forEach(item => existingIds.add(item.id));
          totalGenerated += newItems.length;
          console.log(`    批次 ${b + 1}/${batches}: +${newItems.length} 条（总计 ${pool.length}）`);

          // 每批次保存（防断点丢失）
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pool, null, 2), 'utf-8');
          await sleep(SLEEP_MS);
        } catch (err) {
          console.error(`    ✗ 批次 ${b + 1} 失败: ${err.message}`);
          await sleep(3000); // 失败等久一点
        }
      }
    }
  }

  console.log(`\n=== 完成！共 ${pool.length} 条剧情，新增 ${totalGenerated} 条 ===`);
  console.log(`文件: ${OUTPUT_FILE}`);
  console.log(`大小: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
}

main().catch(console.error);
