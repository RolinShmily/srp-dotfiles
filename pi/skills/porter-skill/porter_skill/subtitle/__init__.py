"""Subtitle processing and generation package."""

from porter_skill.subtitle.controller import (
    SubtitleResult,
    generate_subtitles,
    has_chinese_translation,
    run_asr_transcription,
)
from porter_skill.subtitle.formatter import (
    SubtitleItem,
    align_bilingual_items,
    generate_bilingual_ass,
    generate_bilingual_srt,
    generate_zh_ass,
    generate_zh_srt,
    is_cjk,
    merge_short_fragments,
    parse_srt,
)
from porter_skill.subtitle.translator import (
    translate_with_direct_llm,
    translate_with_google_http,
    translate_with_mymemory_http,
    translate_with_videocaptioner_cli,
)

__all__ = [
    "SubtitleItem",
    "SubtitleResult",
    "align_bilingual_items",
    "generate_bilingual_ass",
    "generate_bilingual_srt",
    "generate_subtitles",
    "generate_zh_ass",
    "generate_zh_srt",
    "has_chinese_translation",
    "is_cjk",
    "merge_short_fragments",
    "parse_srt",
    "run_asr_transcription",
    "translate_with_direct_llm",
    "translate_with_google_http",
    "translate_with_mymemory_http",
    "translate_with_videocaptioner_cli",
]
