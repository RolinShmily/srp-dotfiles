---
description: 字幕转录/精修（VideoCaptioner）——音视频转字幕，可选台词本精修
argument-hint: "<音视频文件路径> [台词本文件路径]"
---
# 字幕转录任务

用户提供：`$1`（音视频文件），`$2`（可选台词本，用于精修校准）。

## 1. 转录

```bash
videocaptioner transcribe "$1" --asr bijian -o "${1%.*}.srt"
```

- `bijian` 免费，支持中英文；其他语言改用 `--asr whisper-api --whisper-api-key <key>`（需要 key）
- 纯音频文件同样支持（自动跳过视频合成）
- 转录完成后先 `read` 检查 SRT 质量（错字、漏句、时间轴错位）

## 2. 精修（有台词本时）

台词本是最佳参照，两种方式：

**方式 A（推荐，零成本）：手动对拍**
- 通读 SRT 与台词本，修正 ASR 错别字、同音字、专有名词
- 按台词本校正断句与换行，保持 SRT 时间轴不变，只改文本
- 直接编辑 SRT 文件（保持 `HH:MM:SS,mmm --> HH:MM:SS,mmm` 格式不动）

**方式 B（LLM 批量优化）**：如用户接受额外开销，可配 LLM：

```bash
export OPENAI_BASE_URL="http://192.168.22.174:20128/v1"   # omniroute 网关
export OPENAI_API_KEY="<omniroute key>"                    # ~/.pi/agent/auth.json 里查
videocaptioner subtitle "$1.srt" --no-translate -o optimized.srt
```

LLM 优化可能改变措辞，重要场合先抽查对比。

## 3. 交付

- 最终 SRT 路径明确告知用户，附简短质量说明（时长、条数、修正要点）
- 用户只需转录时：到第 1 步为止
- 需要双语/翻译/烧录进视频时再扩展（`videocaptioner --help` 看全命令）
