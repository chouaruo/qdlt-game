# 问道链途

当前可继续开发的版本在这个目录：

- 前端主文件: `D:\gameY\public\index.html`
- 服务端接口: `D:\gameY\api\chat.js`
- 服务端生成逻辑: `D:\gameY\lib\chat.js`
- 本地开发服务器: `D:\gameY\server.js`

## 项目现状

这是一个基于 Anthropic 的币圈题材文字冒险游戏。

当前已经完成：

- 前端从浏览器直连 Anthropic 改成了服务端调用
- 本地可运行，也可按当前结构部署到 Vercel
- 增加了自动存档和续档
- 增强了境界突破全屏动画
- 修过一轮人物池，补了多名币圈人物
- 修过一轮服务端生成稳定性，避免剧情写成教程/长文/乱码选项

## 运行方式

1. 在项目根目录放置 `.env`
2. `.env` 至少包含：

```env
ANTHROPIC_API_KEY=你的key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
PORT=3011
```

3. 启动：

```bash
node server.js
```

4. 浏览器打开：

```text
http://127.0.0.1:3011
```

## 主要文件说明

### `public/index.html`

单文件前端页面，包含：

- UI 样式
- 人物数据 `CHARS`
- 词条数据 `TRAIT_POOL`
- 奇遇事件 `EVENTS`
- 本地存档逻辑
- 开局/选项/预生成/突破动画等主流程

如果要改：

- 人物池、头像、文案、开场剧情入口，主要改这里
- 存档、续档、前端交互，也主要改这里

### `lib/chat.js`

当前最关键的服务端文件。

作用：

- 组装给 Anthropic 的 system prompt
- 发送 `/v1/messages` 请求
- 约束 structured output
- 把历史对话从原始 JSON 改成摘要，减少模型跑偏
- 对返回结果做本地校验、归一化和必要重试

如果后续出现：

- 选项乱码
- 剧情突然写成长文、目录、教程
- 输出结构不稳定

优先改这个文件。

### `server.js`

最小本地服务器，负责：

- 读取 `.env`
- 提供静态文件
- 提供 `/api/chat`

## 当前人物池

目前已在 `CHARS` 中加入/保留的人物包括：

- 散户
- CZ
- SBF
- 宝二爷
- 徐明星
- 孙宇晨
- Do Kwon
- 木头姐
- ZachXBT
- Brian Armstrong
- Arthur Hayes
- Michael Saylor
- He Yi
- 吴忌寒
- V神
- 中本聪

## 最近做过的重要修改

1. 前端不再要求用户输入 API Key
2. 增加了首页开场页、继续上次链途、自动存档状态
3. 增强了突破动画
4. 修了 `lose_item` 物品丢失逻辑
5. 修了模型输出偶尔发散的问题：
   - 使用 structured output
   - 加强 prompt
   - 历史摘要化
   - 输出校验和重试

## 已知注意事项

- 不要把 `.env` 上传给别人，里面有真实 API Key
- 如果浏览器提示连接失败，先检查本地服务是否启动
- 如果剧情再次出现明显跑偏，先看 `lib/chat.js`
- 如果角色头像异常，先看 `public/index.html` 里的 `CHARS`

## 给其他 AI/开发者的最短交接方式

如果需要把项目交给另一个 AI，至少上传这几个文件：

- `D:\gameY\README.md`
- `D:\gameY\public\index.html`
- `D:\gameY\lib\chat.js`
- `D:\gameY\server.js`

不要上传：

- `D:\gameY\.env`

