# 看谱找琴键

给读谱初学者使用的本地查键工具：点一下五线谱上的音符，马上查看它对应的钢琴琴键，或吉他的弦与品。
`MusicXML / MXL` 继续使用原来的本地解析链路。只有 `PDF` 和谱面图片会先交给本机 Audiveris 转成 MusicXML，再进入同一套查键界面。识谱过程不调用 AI 模型，也不会产生模型费用。

## 本地运行

需要 Node.js 24（版本见 [`.nvmrc`](.nvmrc)）和 pnpm 10.30.3。依赖中包含 SQLite、图像与 PDF 的原生模块，请使用完整的本机 Node.js 环境。

```bash
nvm use                         # 已安装 nvm 时使用
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

启动后访问 `http://127.0.0.1:3000`。首次运行会自动创建本地存储目录和数据库，无需手动建表。

生产模式可在构建后运行：

```bash
pnpm build
pnpm start --hostname 127.0.0.1
```

如果你不想碰命令行，项目根目录里已经放了一个日常使用的入口，可以直接双击：

- [启动陪练.command](启动陪练.command)

启动入口会自动复用已经运行的本地服务。查看完后直接关闭网页即可，不需要再双击关闭文件；页面连续约 15 分钟没有心跳、且没有识别任务时，后台服务会自动退出。电脑从睡眠中恢复时还会额外等待一小段时间，避免误关。

如果启动异常或需要强制清理，可以使用维护用的 [关闭陪练.command](关闭陪练.command)。它只会关闭本项目自己启动的后台管理进程，不会接管或杀掉其他程序占用的端口。

两个入口会默认管理本地 `3000` 端口，并把运行信息写到：

```text
.runtime/piano-score-coach.pid
.runtime/piano-score-coach.server.pid
.runtime/piano-score-coach.heartbeat
.runtime/piano-score-coach.log
```

## 安装本地识谱工具

导入 `PDF / 图片` 前，需要安装 [Audiveris 5.11 或更高版本](https://github.com/Audiveris/audiveris/releases)。macOS 用户下载与芯片对应的 DMG，把 `Audiveris.app` 拖进“应用程序”即可。首次打开如果被系统拦截，可以在“系统设置 → 隐私与安全性”中选择仍要打开。

如果只导入 `MusicXML / MXL`，不安装 Audiveris 也能照常使用。

带中文歌词的 PDF 需要 OCR 语言模型。运行一次 `node scripts/install-ocr-data.mjs`，会下载并校验官方中英文模型到项目的 `.runtime/tessdata/`。之后识谱离线使用该缓存，不改系统配置；已设置 `TESSDATA_PREFIX` 时会保留你的设置。图片识别仍可能漏字、错音或节奏不准；有 MusicXML 时优先导入它。

## 环境变量

默认配置即可启动。需要自定义时，可把 [`.env.example`](.env.example) 复制为 `.env.local`，取消所需配置的注释后填写本机值；不要提交 `.env.local`。当前导入和查键流程不需要 API key。

常用环境变量有 4 个：

- `AUDIVERIS_COMMAND`
  - 可选。默认会寻找 `/Applications/Audiveris.app/Contents/MacOS/Audiveris`。
  - 如果安装在别处，就填 Audiveris 可执行文件的绝对路径。
- `AUDIVERIS_TIMEOUT_MS`
  - 可选。单次整谱识别的超时时间，默认 `600000` 毫秒。
- `PIANO_COACH_STORAGE_DIR`
  - 可选。默认是当前项目下的 `storage/`。
  - 如果你想把缓存和数据库放到别的目录，可以单独指定。
- `PIANO_COACH_IDLE_TIMEOUT_SECONDS`
  - 可选。网页没有心跳后，等待多久进入自动回收流程；默认 `900` 秒。

示例：

```bash
export AUDIVERIS_COMMAND="/Applications/Audiveris.app/Contents/MacOS/Audiveris"
export AUDIVERIS_TIMEOUT_MS="600000"
# 可选：填入自己用于保存乐谱的本机目录
# export PIANO_COACH_STORAGE_DIR="<your-storage-directory>"
```

双击启动入口的端口、空闲超时等配置由 shell 环境读取，需要通过 `export PIANO_COACH_PORT=3000`、`export PIANO_COACH_IDLE_TIMEOUT_SECONDS=900` 等方式设置；这些启动器配置不会从 `.env.local` 自动读取。`TESSDATA_PREFIX` 可在 shell 中指定已有 OCR 模型目录。

## 本地数据与识别边界

- 作品元数据、SQLite 数据库、原始上传文件、标准化页图都默认保存在本机。
- `PDF / 图片` 会由本机 Audiveris 整份识别，不会发送给 AI 模型。
- `MusicXML / MXL` 仍直接在本地解析，不经过 Audiveris。
- 识别失败时原始页图不会被覆盖，查看页面仍能打开原图。
- 删除作品时，会同时删除本地数据库记录和 `storage/works/<work-id>` 下的缓存文件。

## 存储结构

默认存储目录：

```text
storage/
  app.db
  works/
    <work-id>/
      source/
      pages/
      derived/
  test/
    app.test.db
```

## 标准化管线

为了保证页面顺序、原图回退和缓存稳定，这条管线是固定的：

- `pdfjs-dist` + `@napi-rs/canvas` 把 PDF 渲染成 `300 DPI` 的 `PNG`
- `sharp` 负责 EXIF 方向纠正和图片转 `PNG`
- 多张标准化页图会按用户确认的顺序合成临时 PDF，再交给 Audiveris 整份识别

## 推荐导入顺序

- `MusicXML / MXL`
  - 最推荐，精度最高。
  - 因为它本身就是结构化乐谱数据，系统基本不需要“看图猜音符”。
- `PDF`
  - 当前备用首选。
  - 比拍照和散图更稳定，适合网站直接下载后导入。
- `多张图片`
  - 适合拍打印稿或相册里的谱面。
  - 质量更依赖拍摄角度、清晰度和光线。

## 当前使用方式

1. 导入 MusicXML / MXL、PDF 或谱面图片。
2. 点选不认识的音符，下方立即显示对应位置。和弦显示该和弦自己的组成音，不会把另一谱表同拍的音一起选中。
3. 在结果区切换钢琴或吉他；翻页、放大和缩小都在谱面上方。

乐谱只在自身区域内滚动，查询结果始终留在屏幕下方。页面不提供节拍器、整谱播放、下一音预告或练习进度。外观、吉他调弦与重新识谱收在右上角“查看选项”；上次查看位置和乐器选择仍会保存。

首页只显示乐谱标题、页数和操作。首页与查询结果区使用 `react-liquid-glass-svg` 的 Liquid Glass 表面，谱面保持清晰的实色背景。Safari / iOS 使用该库的模糊降级效果；降低透明度偏好下使用实色表面。

多音跨度较大时，键盘会按可用宽度分成高低音区，保留每个选中音并标明省略范围；极端音区较多时只在键盘区内滚动。吉他显示每个音在当前调弦前 12 品内的对应位置，同弦冲突会提示这些位置不能同时按下，范围外的音会明确列出。

导入和重新识谱期间，列表与查看页会自动更新状态。导入期间可取消等待，文件、标题和页序暂时锁定，避免误改正在提交的内容。损坏文件在创建失败后会清理本次未完成的缓存；已建立作品的识别失败仍保留原图。

图片识谱的准确性仍取决于原稿质量与 Audiveris 的识别结果。

## 启动与关闭说明

- 日常只需要双击一次 `启动陪练.command`。
- 关闭网页不会立即杀掉服务，给重新打开网页留出复用窗口；空闲超时后会自动回收。
- 服务只绑定到本机 `127.0.0.1`，不会主动对局域网提供访问入口。

## 常用命令

```bash
pnpm lint
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Vitest 覆盖 MusicXML 解析、音符与琴键/指板映射、导入流程、数据库、界面交互与后台管理进程。测试使用临时目录与模拟识谱进程，不需要真实 API key。Audiveris 的真实识谱效果仍需要用自己有权使用的乐谱在本机验证。

## 项目结构

```text
src/app/                 Next.js 页面、样式与 API 路由
src/components/          导入、谱面、钢琴键盘与吉他指板界面
src/lib/musicxml/        MusicXML / MXL 导入与解析
src/lib/music/           音高、乐器位置与音频工具
src/lib/recognition/     Audiveris 适配及保留的识别模块
src/lib/works/           作品管理与查看数据
src/lib/db/              Drizzle / SQLite 数据层
src/lib/storage/         本机文件存储
scripts/                启动管理、OCR 模型安装与音色资源生成
public/samples/          应用使用的钢琴和吉他音色及来源说明
docs/research/           识谱方案研究记录
```

项目仍保留旧的 OpenAI 适配模块与测试，当前应用的导入和重新识谱流程使用 Audiveris；发布副本不附带任何凭据，也不需要填写 `OPENAI_API_KEY`。

## 仓库与本机数据

仓库只包含代码、测试、文档、依赖锁文件和应用音色。上传的乐谱、数据库、运行日志、OCR 模型、环境文件和临时导出均保留在本机，见 [`.gitignore`](.gitignore) 和 [安全说明](SECURITY.md)。恢复应用数据时需另外备份和还原 `storage/`。

音色的既有第三方来源说明见 [`public/samples/ATTRIBUTION.md`](public/samples/ATTRIBUTION.md)。本仓库未添加项目开源许可证。
