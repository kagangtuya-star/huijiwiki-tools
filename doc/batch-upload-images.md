# 批量图片上传工具

将本地图片文件夹批量上传到 HuijiWiki，自动进行路径转换和分类标签添加。

## 功能特性

- 递归扫描多层子文件夹中的图片
- 自动路径转换：`spells/FTD/Ashardalon's Stride.webp` → `spells-FTD-Ashardalon's Stride.webp`
- 自动添加维基分类标签（支持中英文分类映射）
- 断点续传：任务中断后可恢复
- 上传日志：记录所有已上传文件，防止重复上传
- 支持并发上传
- 可配置跳过特定文件夹
- dry-run 预览模式

## 安装

```bash
npm install
```

## 配置

复制配置模板并填写实际信息：

```bash
cp config/upload.config.example.json config/upload.config.json
```

编辑 `config/upload.config.json`：

```json
{
  "wiki": {
    "prefix": "dnd5e",
    "authKey": "your-auth-key-here"
  },
  "auth": {
    "username": "YourUsername@BotName",
    "password": "your-bot-password"
  },
  "upload": {
    "comment": "Batch image upload"
  },
  "categoryMapping": {
    "adventure": "模组",
    "backgrounds": "背景",
    "spells": "法术",
    ...
  },
  "skipFolders": ["docker"]
}
```

### 配置说明

| 字段 | 说明 |
|------|------|
| `wiki.prefix` | 维基二级域名，如 `dnd5e` 对应 `dnd5e.huijiwiki.com` |
| `wiki.authKey` | API 认证密钥 |
| `auth.username` | 登录用户名，机器人账号格式为 `User@BotName` |
| `auth.password` | 登录密码或机器人密码 |
| `upload.comment` | 上传时的编辑摘要 |
| `categoryMapping` | 一级文件夹的中英文分类映射表 |
| `skipFolders` | 需要跳过的文件夹列表（如 `docker`） |

### 分类映射表

配置文件中预置了完整的分类映射：

| 英文文件夹 | 中文分类 |
|-----------|----------|
| adventure | 模组 |
| backgrounds | 背景 |
| bastions | 据点 |
| bestiary | 怪物 |
| book | 扩展 |
| characters | 人物 |
| charcreationoptions | 职业选项 |
| classes | 职业 |
| conditions | 状态 |
| diseases | 疾病 |
| covers | 封面 |
| decks | 卡牌 |
| deities | 神祇 |
| dmscreen | 帷幕 |
| feats | 专长 |
| hazards | 危害 |
| items | 道具 |
| languages | 语言 |
| object | 物件 |
| optionalfeatures | 职业能力选项 |
| pdf | PDF |
| races | 种族 |
| recipes | 食谱 |
| spells | 法术 |
| traps | 陷阱 |
| variantrules | 术语 |
| vehicles | 载具 |

## 使用方法

### 基本用法

```bash
# 上传图片
node tools/batch-upload-images.js -s ./images -c ./config/upload.config.json

# 或使用 npm script
npm run upload -- -s ./images
```

### 预览模式（dry-run）

不实际上传，仅预览转换结果：

```bash
node tools/batch-upload-images.js -s ./images --dry-run

# 或
npm run upload:dry-run -- -s ./images
```

### 断点续传

任务中断后，可从进度文件恢复：

```bash
node tools/batch-upload-images.js --resume ./upload-progress.json
```

### 重试失败项

仅重试之前失败的文件：

```bash
node tools/batch-upload-images.js --retry-failed ./upload-progress.json
```

### 并发上传

设置并发数提高上传速度：

```bash
node tools/batch-upload-images.js -s ./images --concurrency 3
```

## 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-s, --source <dir>` | 源图片文件夹路径 | 必填（新任务） |
| `-c, --config <file>` | 配置文件路径 | `./config/upload.config.json` |
| `--progress-file <file>` | 进度文件路径 | `./upload-progress.json` |
| `--log-file <file>` | 上传日志文件路径 | `./logs/upload.log` |
| `--resume <file>` | 从进度文件恢复 | - |
| `--retry-failed <file>` | 重试失败的文件 | - |
| `--dry-run` | 预览模式，不实际上传 | `false` |
| `--concurrency <n>` | 并发上传数 | `1` |
| `-h, --help` | 显示帮助信息 | - |

## 分类标签规则

### 生成格式

```
[[Category:插图]][[Category:扩展id]][[Category:大分类]][[Category:扩展id插图]]
```

### 目录结构示例

```
images/
├── spells/
│   ├── FTD/
│   │   ├── Ashardalon's Stride.webp
│   │   └── Fireball.webp
│   └── Magic Missile.webp
├── monsters/
│   └── MM/
│       └── Dragon.png
└── docker/          # 会被跳过
    └── some-file.png
```

### 转换规则

| 原始路径 | 上传文件名 | 分类标签 |
|----------|------------|----------|
| `spells/FTD/Ashardalon's Stride.webp` | `spells-FTD-Ashardalon's Stride.webp` | `[[Category:插图]][[Category:FTD]][[Category:法术]][[Category:FTD插图]]` |
| `spells/Magic Missile.webp` | `spells-Magic Missile.webp` | `[[Category:插图]][[Category:法术]]` |
| `bestiary/MM/Dragon.png` | `bestiary-MM-Dragon.png` | `[[Category:插图]][[Category:MM]][[Category:怪物]][[Category:MM插图]]` |

### 分类说明

- **`[[Category:插图]]`**：固定分类，所有图片都会添加
- **`[[Category:扩展id]]`**：二级文件夹名称（保留原始大小写），如 `FTD`、`MM`
- **`[[Category:大分类]]`**：一级文件夹对应的中文分类（通过 `categoryMapping` 映射）
- **`[[Category:扩展id插图]]`**：扩展id + "插图"，如 `FTD插图`

## 日志文件

### 进度文件 (`upload-progress.json`)

记录当前任务状态，用于断点续传：

```json
{
  "taskId": "20260112133000",
  "sourceDir": "/path/to/images",
  "totalFiles": 150,
  "pendingFiles": ["..."],
  "completed": ["..."],
  "failed": [{"file": "...", "error": "...", "attempts": 3}]
}
```

### 上传日志 (`logs/upload.log`)

记录所有上传历史，防止重复上传：

```
[2026-01-12T13:30:00.000Z] SUCCESS spells-FTD-Fireball.webp -> dnd5e
[2026-01-12T13:30:01.000Z] SKIPPED spells-FTD-Fireball.webp (Already uploaded)
[2026-01-12T13:30:02.000Z] FAILED  monsters-MM-Dragon.png (Network timeout)
```

## 支持的图片格式

- `.webp`
- `.png`
- `.jpg` / `.jpeg`
- `.gif`
- `.svg`
- `.bmp`
- `.ico`

## 特殊字符处理

| 字符 | 处理方式 |
|------|----------|
| `/` | 转换为 `-`（目录分隔符） |
| `:` | 转换为 `_` |
| `#`, `?`, `<`, `>`, `\|`, `"`, `\` | 转换为 `_` |
| 空格 | 保留 |
| 单引号 `'` | 保留 |
