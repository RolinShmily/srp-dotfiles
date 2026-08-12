---
description: 字幕转录/精修（VideoCaptioner + agent 对拍）——音视频转字幕，可选台词本精修
argument-hint: "<音视频文件路径> [台词本文件路径]"
---
# 字幕转录任务

用户提供：`$1`（音视频文件），`$2`（可选台词本，用于精修校准）。

## 1. 转录（videocaptioner 只做这一步）

```bash
videocaptioner transcribe "$1" --asr bijian -o "${1%.*}.srt"
```

- `bijian` 免费，支持中英文；其他语言改用 `--asr whisper-api`（需要 key）
- 纯音频文件同样支持（自动跳过视频合成）
- 转录完成后先 `read` 检查 SRT 质量（错字、漏句、时间轴错位）

## 2. 精修（agent 直接做，不需要 CLI 的 LLM 功能）

**有台词本（推荐路径）**：
1. `read` 转录出的 SRT 和台词本
2. 逐句对拍：修正 ASR 错别字、同音字、专有名词，按台词本校正断句
3. 用 `edit` 修改 SRT（保持 `HH:MM:SS,mmm --> HH:MM:SS,mmm` 时间轴和序号不变，只改文本）
4. 句子多时按块分批处理；时间轴错位明显的用时间戳推算校正

**无台词本**：
- 只修明显 ASR 错误（同音字、错别字、漏字、标点）
- 不要过度改写措辞；不确定的地方保持原样，交付时标注存疑处

## 3. 交付

- 最终 SRT 路径明确告知用户，附简短质量说明（时长、条数、修正要点）
- 用户只需转录时：到第 1 步为止
- 需要双语/翻译/烧录进视频时再扩展（`videocaptioner --help` 看全命令）

<!-- 上游参考（命令不确定时自行查证，不进入工作流）：
项目 https://github.com/WEIFENG2333/VideoCaptioner
Skill 原文 https://github.com/WEIFENG2333/VideoCaptioner/blob/master/skills/SKILL.md -->
