# Japanese voice-journal ASR benchmark

Transcription engines compared on unscripted Japanese voice-journal audio - mostly single-speaker dictation, with some conversational passages. Aggregate results only: the corpus behind these numbers is private and is not part of this repository.

- **Samples**: 122
- **Audio per model**: 3h 5m
- **Judge**: `gpt-5.6-luna`, temperature `0`
- **Score**: Proper-noun F1 and Proposition F-beta, weighted proper_noun_f1 0.3, proposition_quality 0.7

## Leaderboard

| # | Model | Overall | 95% CI | Proper-noun F1 | Proposition recall | Proposition precision | Proposition F-beta | RTF | Latency p50 / p95 |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | **Gemini 3.8 Flash** | **75.1%** | [70.6, 79.5] | 65.9% | 86.2% | 79.1% | 81.1% | 0.07x | 5337 / 15769 ms |
| 2 | **Gemini 3.8 Flash (no thinking)** | **71.7%** | [66.6, 76.6] | 56.0% | 84.6% | 80.8% | 80.8% | 0.03x | 2803 / 4926 ms |
| 3 | **Gemini 3.5 Transcribe** | **66.3%** | [61.6, 71.0] | 52.8% | 77.2% | 74.0% | 74.7% | 0.03x | 2056 / 3850 ms |
| 4 | **Meta Muse Voice Transcribe** | **66.2%** | [62.3, 70.1] | 39.9% | 81.7% | 80.6% | 79.2% | 0.15x | 11498 / 31551 ms |
| 5 | **Groq Whisper large-v3** | **63.9%** | [59.5, 68.1] | 47.4% | 78.6% | 73.8% | 74.7% | 0.03x | 1004 / 8329 ms |
| 6 | **xAI Grok STT** | **48.0%** | [43.3, 52.6] | 23.9% | 61.8% | 65.2% | 60.4% | 0.01x | 934 / 2087 ms |

![Price versus score](charts/price-performance.svg)

![Speed versus score](charts/speed-performance.svg)

![Score by axis](charts/score-breakdown.svg)

## Is the ranking real?

| Model A | Model B | Δ | 95% CI | Adjusted CI | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Gemini 3.8 Flash | Gemini 3.8 Flash (no thinking) | +3.4pp | [-0.4, +7.1] | [-2.6, +9.4] | ➖ |
| Gemini 3.8 Flash | Gemini 3.5 Transcribe | +8.8pp | [+5.1, +12.7] | [+3.0, +14.4] | ✅ |
| Gemini 3.8 Flash | Meta Muse Voice Transcribe | +8.9pp | [+5.3, +12.4] | [+3.2, +14.2] | ✅ |
| Gemini 3.8 Flash | Groq Whisper large-v3 | +11.1pp | [+7.9, +14.4] | [+6.1, +16.1] | ✅ |
| Gemini 3.8 Flash | xAI Grok STT | +27.1pp | [+23.0, +31.2] | [+20.8, +33.8] | ✅ |
| Gemini 3.8 Flash (no thinking) | Gemini 3.5 Transcribe | +5.4pp | [+1.4, +9.5] | [-0.7, +11.8] | 🔸 |
| Gemini 3.8 Flash (no thinking) | Meta Muse Voice Transcribe | +5.5pp | [+1.4, +9.6] | [-1.6, +11.9] | 🔸 |
| Gemini 3.8 Flash (no thinking) | Groq Whisper large-v3 | +7.4pp | [+3.3, +11.8] | [+1.5, +13.8] | ✅ |
| Gemini 3.8 Flash (no thinking) | xAI Grok STT | +23.7pp | [+19.3, +28.2] | [+17.2, +30.3] | ✅ |
| Gemini 3.5 Transcribe | Meta Muse Voice Transcribe | +0.2pp | [-3.2, +3.3] | [-5.1, +4.7] | ➖ |
| Gemini 3.5 Transcribe | Groq Whisper large-v3 | +2.1pp | [-1.2, +5.3] | [-2.7, +6.7] | ➖ |
| Gemini 3.5 Transcribe | xAI Grok STT | +18.3pp | [+14.6, +22.2] | [+13.0, +24.2] | ✅ |
| Meta Muse Voice Transcribe | Groq Whisper large-v3 | +2.2pp | [-1.0, +5.6] | [-2.7, +7.3] | ➖ |
| Meta Muse Voice Transcribe | xAI Grok STT | +18.1pp | [+14.7, +21.8] | [+13.3, +23.7] | ✅ |
| Groq Whisper large-v3 | xAI Grok STT | +15.6pp | [+12.0, +19.4] | [+10.3, +21.0] | ✅ |

> Every pair, not just rank-adjacent ones - a chain of indistinguishable neighbours says nothing about the models at the two ends. Paired bootstrap of the per-sample difference (same audio for every model), Bonferroni-adjusted for the number of pairs, plus an exact McNemar test per axis.

Discriminating samples: **119 / 122** · Proposition recall 77/122 · Proposition precision 76/122

## Token Usage & Cost

| Model | ASR in | ASR out | ASR cost | Judge in | Judge out | Judge cost | Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Gemini 3.8 Flash** | 281,808 | 160,028 | $0.8115 | 2,945,370 | 603,911 | $0.8376 | $1.65 |
| **Gemini 3.8 Flash (no thinking)** | 281,808 | 20,918 | $0.2898 | 2,864,271 | 557,527 | $0.7830 | $1.07 |
| **Gemini 3.5 Transcribe** | 281,807 | - | ~$0.9324 | 2,786,718 | 704,239 | $0.9536 | $1.89 |
| **Groq Whisper large-v3** | - | - | $0.3202 | 2,830,468 | 791,757 | $1.08 | $1.40 |
| **Meta Muse Voice Transcribe** | - | - | $0.5564 | 2,958,848 | 809,577 | $1.10 | $1.65 |
| **xAI Grok STT** | - | - | $0.3091 | 2,755,423 | 919,710 | $1.21 | $1.52 |
| **TOTAL** | | | **$3.22** | | | **$5.96** | **$9.18** |

## Experiment Conditions

| Model | Provider | Request parameters |
| :--- | :--- | :--- |
| **Gemini 3.8 Flash** | gemini | `model`: gemini-3.8-flash<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: provider default<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Gemini 3.8 Flash (no thinking)** | gemini | `model`: gemini-3.8-flash<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: 0<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Gemini 3.5 Transcribe** | gemini | `model`: gemini-3.5-transcribe<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: provider default<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Groq Whisper large-v3** | groq | `model`: whisper-large-v3<br>`endpoint`: https://api.groq.com/openai/v1/audio/transcriptions<br>`language`: ja<br>`response_format`: json<br>`temperature`: provider default<br>`prompt`: (none) |
| **Meta Muse Voice Transcribe** | meta | `model`: muse-voice-transcribe-1.0<br>`endpoint`: https://api.meta.ai/v1/asr/transcribe<br>`mode`: DIARIZATION<br>`audioEncoding`: WAV<br>`languageBias`: Japanese<br>`keywords`: <br>`preprocessing`: ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le |
| **xAI Grok STT** | xai | `model`: grok-stt<br>`endpoint`: https://api.x.ai/v1/stt<br>`language`: ja<br>`prompt`: (none) |

_Generated by `kikitori publish` from run `run_2026-09-08T02-40-45-884Z` on 2026-09-09, at github.com/ainoya/kikitori-bench @ `888247c+local changes`._
