# PDF 与图片乐谱的开源识别方案

## 结论

本项目可以取消云端 AI 识别，改成“本地 OMR 转 MusicXML，再走现有练习链路”。

默认方案建议用 Audiveris，homr 作为对照测试。

识别失败时保留原图查看，不要让整份乐谱导入失败。

这能取消按页调用 AI 的费用，但本地识别仍会占用 CPU、内存和处理时间。

## 候选项目

### 1. Audiveris，首选

- GitHub：[Audiveris](https://github.com/Audiveris/audiveris)
- 输入：PDF、TIFF、JPG、PNG、BMP。
- 输出：压缩的 MusicXML，也就是 MXL。
- 支持命令行批处理、识别和导出。
- 自带图形界面，可以人工检查和修正识别结果。
- 适合多页、标准印刷五线谱。
- 许可证：AGPL，正式集成前需要确认项目的许可方式。

相关文档：

- [支持的输入格式](https://audiveris.github.io/audiveris/_pages/tutorials/quick/load/)
- [命令行批处理](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/)
- [导出 MusicXML](https://audiveris.github.io/audiveris/_pages/tutorials/quick/export/)

### 2. homr，适合做 A/B 测试

- GitHub：[homr](https://github.com/liebharc/homr)
- 输入：图片和 PDF。
- 输出：MusicXML。
- 可以只用 CPU 运行，不需要云端接口。
- 主要覆盖高音谱号、低音谱号、音高和节奏。
- 力度、奏法等细节覆盖不足，不能把输出当成完全准确的原谱。
- 许可证：AGPL。

homr 更适合照片、简单钢琴谱等场景，但是否比 Audiveris 更准，需要用本项目的真实乐谱验证。

### 3. oemer，不建议作为默认方案

- GitHub：[oemer](https://github.com/BreezeWhite/oemer)
- 输入：图片。
- 输出：MusicXML。
- 许可证：MIT。
- 项目相对偏旧，而且它自己的 README 也建议关注 homr。

它可以保留为备用方案，但不值得优先投入接入成本。

### 4. alphaTab，只处理结构化吉他谱

- GitHub：[alphaTab](https://github.com/CoderLine/alphaTab)
- 能加载和渲染 Guitar Pro 3 到 7 以及 MusicXML。
- 它不识别 PDF，也不识别图片。

如果能下载到 Guitar Pro 文件，可以直接走 alphaTab 或先转成 MusicXML，准确性通常比 OCR 路线更可控。

## 吉他六线谱的限制

只含 TAB 的 PDF 或图片，目前没有成熟、通用、可直接接入的开源识别方案。

Audiveris 对 TAB 的支持也不适合作为稳定生产能力，可参考其 [TAB 讨论](https://github.com/Audiveris/audiveris/discussions/754)。

因此，TAB-only 文件应保留原图浏览，并允许用户改用 Guitar Pro、MusicXML 或人工录入。

## 对本项目的接入建议

1. 保留现有 300 DPI 的 PDF 转图片和图片归一化流程。
2. MusicXML、MXL 继续直接解析，不经过 OMR。
3. PDF 和图片默认交给本地 Audiveris，输出 MXL。
4. 将输出的 MXL 接到现有 MusicXML 解析和 OSMD 渲染链路。
5. homr 放在实验开关后，用同一批样本和 Audiveris 对比。
6. 永久保存原始 PDF 或图片，方便核对错误。
7. OMR 失败时进入“仅看原谱”模式，并允许重新识别或上传替代文件。

数据结构也需要调整。`sourceType` 只表示用户上传的是 PDF、图片还是 MusicXML，不能再决定练习页如何渲染。

建议新增 `renderFormat` 或 `derivedFormat`，并记录 OMR 生成的 MXL 路径、识别器名称、版本和状态。

## 先做小规模评测

正式选型前，先收集 15 到 30 份真实乐谱，覆盖扫描 PDF、电子 PDF、手机照片、钢琴大谱表和吉他谱。

对 Audiveris 与 homr 比较音高、节奏、小节、声部、多页连续性、失败率和处理时间。

如果 Audiveris 在常见样本上明显更稳，就只保留一个生产识别器。homr 不必长期变成第二套维护成本。
