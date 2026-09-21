# Japanese voice-journal ASR benchmark

Transcription engines compared on unscripted Japanese voice-journal audio - mostly single-speaker dictation, with some conversational passages. Aggregate results only: the corpus behind these numbers is private and is not part of this repository.

- **Samples**: 122
- **Audio per model**: 3h 5m
- **Judge**: `gpt-5.6-luna`, temperature `0`, reasoning effort `low`
- **Score**: Proper-noun F1 and Proposition F-beta, weighted proper_noun_f1 0.3, proposition_quality 0.7

## Leaderboard

| # | Model | Overall | 95% CI | Proper-noun F1 | Proposition recall | Proposition precision | Proposition F-beta | RTF | Latency p50 / p95 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | **Gemini 3.8 Flash** | **76.1%** | [71.5, 80.4] | 62.8% | 87.5% | 83.8% | 84.4% | 0.06x | 4669 / 13292 ms |
| 2 | **Gemini 3.8 Flash (no thinking)** | **71.1%** | [65.8, 76.3] | 58.6% | 81.0% | 80.7% | 78.7% | 0.04x | 2997 / 7793 ms |
| 3 | **Gemini 3.5 Transcribe** | **69.2%** | [64.7, 73.6] | 52.8% | 79.1% | 78.8% | 78.4% | 0.03x | 2305 / 3923 ms |
| 4 | **Meta Muse Voice Transcribe** | **68.4%** | [64.7, 72.0] | 40.1% | 81.2% | 86.1% | 82.1% | 0.16x | 11810 / 35877 ms |
| 5 | **Apple SpeechTranscriber** | **68.4%** | [64.4, 72.1] | 41.1% | 80.8% | 87.6% | 82.0% | 0.01x | 614 / 1459 ms |
| 6 | **Groq Whisper large-v3** | **66.4%** | [62.2, 70.5] | 47.3% | 78.7% | 79.4% | 77.9% | 0.12x | 1291 / 67733 ms |
| 7 | **Qwen3-ASR 1.7B (MLX, 8-bit)** | **63.2%** | [58.9, 67.2] | 34.1% | 78.6% | 81.4% | 77.6% | 0.12x | 3705 / 33939 ms |
| 8 | **Qwen3-ASR 0.6B (MLX, 8-bit)** | **57.8%** | [53.1, 62.3] | 34.4% | 71.6% | 75.4% | 71.1% | 0.05x | 1885 / 7333 ms |
| 9 | **Apple DictationTranscriber** | **57.1%** | [52.1, 62.1] | 44.0% | 62.7% | 78.6% | 66.0% | 0.03x | 2402 / 7585 ms |
| 10 | **xAI Grok STT** | **49.6%** | [44.8, 54.5] | 23.6% | 61.7% | 70.2% | 62.5% | 0.02x | 1142 / 3398 ms |

![Price versus score](charts/price-performance.svg)

_Models without a calculable ASR price are excluded from the price/performance chart and frontier._

![Speed versus score](charts/speed-performance.svg)

_Apple transcription runs on-device, so its RTF can vary with host hardware, OS, and installed speech-model assets; the measured host is recorded in Experiment Conditions._

![Score by axis](charts/score-breakdown.svg)

## Is the ranking real?

| Model A | Model B | Δ | 95% CI | Adjusted CI | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Gemini 3.8 Flash | Gemini 3.8 Flash (no thinking) | +5.0pp | [+1.5, +8.9] | [+0.0, +11.8] | 🔸 |
| Gemini 3.8 Flash | Gemini 3.5 Transcribe | +6.9pp | [+3.4, +10.5] | [+0.9, +12.7] | ✅ |
| Gemini 3.8 Flash | Meta Muse Voice Transcribe | +7.8pp | [+3.8, +11.4] | [+0.6, +13.6] | ✅ |
| Gemini 3.8 Flash | Apple SpeechTranscriber | +7.8pp | [+4.0, +11.6] | [+1.1, +13.9] | ✅ |
| Gemini 3.8 Flash | Groq Whisper large-v3 | +9.8pp | [+6.1, +13.3] | [+3.6, +15.6] | ✅ |
| Gemini 3.8 Flash | Qwen3-ASR 1.7B (MLX, 8-bit) | +12.9pp | [+9.6, +16.3] | [+8.0, +18.0] | ✅ |
| Gemini 3.8 Flash | Qwen3-ASR 0.6B (MLX, 8-bit) | +18.4pp | [+14.4, +22.5] | [+12.2, +25.0] | ✅ |
| Gemini 3.8 Flash | Apple DictationTranscriber | +19.0pp | [+14.9, +23.2] | [+11.8, +26.2] | ✅ |
| Gemini 3.8 Flash | xAI Grok STT | +26.5pp | [+22.6, +30.7] | [+19.9, +33.9] | ✅ |
| Gemini 3.8 Flash (no thinking) | Gemini 3.5 Transcribe | +1.9pp | [-2.6, +6.4] | [-5.9, +8.9] | ➖ |
| Gemini 3.8 Flash (no thinking) | Meta Muse Voice Transcribe | +2.7pp | [-2.3, +7.7] | [-5.3, +10.4] | ➖ |
| Gemini 3.8 Flash (no thinking) | Apple SpeechTranscriber | +2.7pp | [-1.7, +7.3] | [-5.2, +9.9] | ➖ |
| Gemini 3.8 Flash (no thinking) | Groq Whisper large-v3 | +4.7pp | [+0.6, +8.8] | [-1.7, +11.2] | 🔸 |
| Gemini 3.8 Flash (no thinking) | Qwen3-ASR 1.7B (MLX, 8-bit) | +7.9pp | [+3.8, +11.9] | [+1.2, +14.6] | ✅ |
| Gemini 3.8 Flash (no thinking) | Qwen3-ASR 0.6B (MLX, 8-bit) | +13.3pp | [+8.5, +18.1] | [+6.0, +21.4] | ✅ |
| Gemini 3.8 Flash (no thinking) | Apple DictationTranscriber | +14.0pp | [+9.1, +19.2] | [+5.4, +22.4] | ✅ |
| Gemini 3.8 Flash (no thinking) | xAI Grok STT | +21.5pp | [+16.5, +26.6] | [+13.9, +30.1] | ✅ |
| Gemini 3.5 Transcribe | Meta Muse Voice Transcribe | +0.8pp | [-2.8, +4.2] | [-6.1, +6.1] | ➖ |
| Gemini 3.5 Transcribe | Apple SpeechTranscriber | +0.8pp | [-2.4, +4.0] | [-4.6, +5.8] | ➖ |
| Gemini 3.5 Transcribe | Groq Whisper large-v3 | +2.8pp | [-0.7, +6.1] | [-3.0, +7.7] | ➖ |
| Gemini 3.5 Transcribe | Qwen3-ASR 1.7B (MLX, 8-bit) | +6.0pp | [+3.2, +8.8] | [+1.5, +10.4] | ✅ |
| Gemini 3.5 Transcribe | Qwen3-ASR 0.6B (MLX, 8-bit) | +11.4pp | [+8.0, +15.0] | [+6.2, +17.3] | ✅ |
| Gemini 3.5 Transcribe | Apple DictationTranscriber | +12.1pp | [+8.0, +16.3] | [+5.3, +19.3] | ✅ |
| Gemini 3.5 Transcribe | xAI Grok STT | +19.6pp | [+15.7, +23.7] | [+13.9, +26.3] | ✅ |
| Meta Muse Voice Transcribe | Apple SpeechTranscriber | +0.0pp | [-3.5, +3.6] | [-5.8, +5.7] | ➖ |
| Meta Muse Voice Transcribe | Groq Whisper large-v3 | +2.0pp | [-1.3, +5.4] | [-3.8, +7.5] | ➖ |
| Meta Muse Voice Transcribe | Qwen3-ASR 1.7B (MLX, 8-bit) | +5.2pp | [+2.1, +8.4] | [+0.4, +10.4] | ✅ |
| Meta Muse Voice Transcribe | Qwen3-ASR 0.6B (MLX, 8-bit) | +10.6pp | [+6.9, +14.4] | [+4.9, +17.0] | ✅ |
| Meta Muse Voice Transcribe | Apple DictationTranscriber | +11.3pp | [+6.7, +15.9] | [+4.0, +18.6] | ✅ |
| Meta Muse Voice Transcribe | xAI Grok STT | +18.8pp | [+14.7, +23.0] | [+11.9, +25.8] | ✅ |
| Apple SpeechTranscriber | Groq Whisper large-v3 | +2.0pp | [-1.7, +5.5] | [-3.8, +8.8] | ➖ |
| Apple SpeechTranscriber | Qwen3-ASR 1.7B (MLX, 8-bit) | +5.2pp | [+2.3, +8.2] | [+0.2, +10.7] | ✅ |
| Apple SpeechTranscriber | Qwen3-ASR 0.6B (MLX, 8-bit) | +10.6pp | [+7.0, +14.2] | [+4.7, +17.2] | ✅ |
| Apple SpeechTranscriber | Apple DictationTranscriber | +11.3pp | [+8.1, +14.7] | [+6.2, +16.6] | ✅ |
| Apple SpeechTranscriber | xAI Grok STT | +18.8pp | [+14.8, +22.8] | [+12.7, +25.7] | ✅ |
| Groq Whisper large-v3 | Qwen3-ASR 1.7B (MLX, 8-bit) | +3.2pp | [+0.1, +6.5] | [-1.4, +8.2] | 🔸 |
| Groq Whisper large-v3 | Qwen3-ASR 0.6B (MLX, 8-bit) | +8.6pp | [+5.0, +12.4] | [+2.3, +15.4] | ✅ |
| Groq Whisper large-v3 | Apple DictationTranscriber | +9.3pp | [+4.9, +13.8] | [+2.5, +16.0] | ✅ |
| Groq Whisper large-v3 | xAI Grok STT | +16.7pp | [+12.9, +20.9] | [+10.6, +24.0] | ✅ |
| Qwen3-ASR 1.7B (MLX, 8-bit) | Qwen3-ASR 0.6B (MLX, 8-bit) | +5.4pp | [+2.2, +8.9] | [+0.8, +11.0] | ✅ |
| Qwen3-ASR 1.7B (MLX, 8-bit) | Apple DictationTranscriber | +6.1pp | [+2.2, +10.0] | [-0.4, +12.7] | 🔸 |
| Qwen3-ASR 1.7B (MLX, 8-bit) | xAI Grok STT | +13.6pp | [+10.2, +17.1] | [+8.5, +19.7] | ✅ |
| Qwen3-ASR 0.6B (MLX, 8-bit) | Apple DictationTranscriber | +0.7pp | [-4.0, +5.3] | [-7.8, +8.3] | ➖ |
| Qwen3-ASR 0.6B (MLX, 8-bit) | xAI Grok STT | +8.1pp | [+4.2, +12.4] | [+1.5, +15.5] | ✅ |
| Apple DictationTranscriber | xAI Grok STT | +7.5pp | [+3.2, +11.9] | [+0.9, +15.3] | ✅ |

> Every pair, not just rank-adjacent ones - a chain of indistinguishable neighbours says nothing about the models at the two ends. Paired bootstrap of the per-sample difference (same audio for every model), Bonferroni-adjusted for the number of pairs, plus an exact McNemar test per axis.

Discriminating samples: **120 / 122** · Proposition recall 85/122 · Proposition precision 100/122

## Token Usage & Cost

| Model | ASR in | ASR out | ASR cost | Judge in | Judge out | Judge cost | Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **xAI Grok STT** | - | - | $0.3091 | 2,781,803 | 108,527 | $0.2565 | $0.5657 |
| **Gemini 3.8 Flash** | 281,808 | 119,675 | $0.6601 | 2,933,593 | 96,545 | $0.2724 | $0.9326 |
| **Gemini 3.8 Flash (no thinking)** | 281,808 | 20,496 | $0.2882 | 2,789,375 | 90,834 | $0.2523 | $0.5405 |
| **Gemini 3.5 Transcribe** | 281,807 | - | ~$0.9324 | 2,809,493 | 101,174 | $0.2623 | $1.19 |
| **Groq Whisper large-v3** | - | - | $0.3441 | 2,950,900 | 105,990 | $0.2697 | $0.6138 |
| **Meta Muse Voice Transcribe** | - | - | $0.5564 | 2,952,750 | 108,680 | $0.2676 | $0.8240 |
| **Qwen3-ASR 1.7B (MLX, 8-bit)** | 146,882 | 69,164 | - | 2,963,143 | 107,552 | $0.2407 | - |
| **Qwen3-ASR 0.6B (MLX, 8-bit)** | 146,882 | 53,096 | - | 2,946,568 | 113,181 | $0.2526 | - |
| **Apple SpeechTranscriber** | - | - | - | 2,867,513 | 103,155 | $0.2245 | - |
| **Apple DictationTranscriber** | - | - | - | 2,815,230 | 103,979 | $0.2181 | - |
| **TOTAL** | | | **-** | | | **$2.52** | **-** |

## Experiment Conditions

| Model | Provider | Request parameters |
| :--- | :--- | :--- |
| **xAI Grok STT** | xai | `model`: grok-stt<br>`endpoint`: https://api.x.ai/v1/stt<br>`language`: ja<br>`prompt`: (none) |
| **Gemini 3.8 Flash** | gemini | `model`: gemini-3.8-flash<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: provider default<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Gemini 3.8 Flash (no thinking)** | gemini | `model`: gemini-3.8-flash<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: 0<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Gemini 3.5 Transcribe** | gemini | `model`: gemini-3.5-transcribe<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: provider default<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Groq Whisper large-v3** | groq | `model`: whisper-large-v3<br>`endpoint`: https://api.groq.com/openai/v1/audio/transcriptions<br>`language`: ja<br>`response_format`: json<br>`temperature`: provider default<br>`prompt`: (none) |
| **Meta Muse Voice Transcribe** | meta | `model`: muse-voice-transcribe-1.0<br>`endpoint`: https://api.meta.ai/v1/asr/transcribe<br>`mode`: DIARIZATION<br>`audioEncoding`: WAV<br>`languageBias`: Japanese<br>`keywords`: <br>`preprocessing`: ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le |
| **Qwen3-ASR 1.7B (MLX, 8-bit)** | mlx-audio | `framework`: mlx-audio (Apple MLX)<br>`model`: mlx-community/Qwen3-ASR-1.7B-8bit<br>`language`: Japanese<br>`prompt`: none<br>`hotwords`: <br>`maxTokens`: 8192 (library default)<br>`chunkSeconds`: 1200 (library default)<br>`batchSegments`: 1 (library default)<br>`temperature`: 0.0 (library default)<br>`processing`: on-device<br>`hardware`: Apple M1 Pro, 32 GB RAM<br>`timing`: generation only (excludes model load, audio transcoding, and queue wait) |
| **Qwen3-ASR 0.6B (MLX, 8-bit)** | mlx-audio | `framework`: mlx-audio (Apple MLX)<br>`model`: mlx-community/Qwen3-ASR-0.6B-8bit<br>`language`: Japanese<br>`prompt`: none<br>`hotwords`: <br>`maxTokens`: 8192 (library default)<br>`chunkSeconds`: 1200 (library default)<br>`batchSegments`: 1 (library default)<br>`temperature`: 0.0 (library default)<br>`processing`: on-device<br>`hardware`: Apple M1 Pro, 32 GB RAM<br>`timing`: generation only (excludes model load, audio transcoding, and queue wait) |
| **Apple SpeechTranscriber** | apple | `framework`: SpeechAnalyzer<br>`model`: SpeechTranscriber<br>`locale`: ja-JP<br>`preset`: transcription<br>`processing`: on-device<br>`hardware`: Apple M1 Pro, 32 GB RAM<br>`timing`: analyze+finalize (excludes helper launch, asset checks, and queue wait) |
| **Apple DictationTranscriber** | apple | `framework`: SpeechAnalyzer<br>`model`: DictationTranscriber<br>`locale`: ja-JP<br>`preset`: longDictation<br>`processing`: on-device<br>`hardware`: Apple M1 Pro, 32 GB RAM<br>`timing`: analyze+finalize (excludes helper launch, asset checks, and queue wait) |

_Generated by `kikitori publish` from run `run_2026-09-21T09-00-00-000Z` on 2026-09-21, at github.com/ainoya/kikitori-bench @ `b1464f2+local changes`._
