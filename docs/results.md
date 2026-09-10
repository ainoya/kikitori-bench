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
| 3 | **Apple SpeechTranscriber** | **67.1%** | [63.1, 70.9] | 41.1% | 80.2% | 84.0% | 80.3% | 0.01x | 615 / 1465 ms |
| 4 | **Gemini 3.5 Transcribe** | **66.3%** | [61.6, 71.0] | 52.8% | 77.2% | 74.0% | 74.7% | 0.03x | 2056 / 3850 ms |
| 5 | **Meta Muse Voice Transcribe** | **66.2%** | [62.3, 70.1] | 39.9% | 81.7% | 80.6% | 79.2% | 0.15x | 11498 / 31551 ms |
| 6 | **Groq Whisper large-v3** | **63.9%** | [59.5, 68.1] | 47.4% | 78.6% | 73.8% | 74.7% | 0.03x | 1004 / 8329 ms |
| 7 | **Apple DictationTranscriber** | **55.3%** | [50.2, 60.3] | 44.0% | 60.9% | 75.3% | 63.5% | 0.03x | 2472 / 7387 ms |
| 8 | **xAI Grok STT** | **48.0%** | [43.3, 52.6] | 23.9% | 61.8% | 65.2% | 60.4% | 0.01x | 934 / 2087 ms |

![Price versus score](charts/price-performance.svg)

_Models without a calculable ASR price are excluded from the price/performance chart and frontier._

![Speed versus score](charts/speed-performance.svg)

_Apple transcription runs on-device, so its RTF can vary with host hardware, OS, and installed speech-model assets; the measured host is recorded in Experiment Conditions._

![Score by axis](charts/score-breakdown.svg)

## Is the ranking real?

| Model A | Model B | Δ | 95% CI | Adjusted CI | Verdict |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Gemini 3.8 Flash | Gemini 3.8 Flash (no thinking) | +3.4pp | [-0.4, +7.1] | [-3.1, +9.8] | ➖ |
| Gemini 3.8 Flash | Apple SpeechTranscriber | +8.0pp | [+4.0, +11.8] | [+1.7, +13.8] | ✅ |
| Gemini 3.8 Flash | Gemini 3.5 Transcribe | +8.8pp | [+5.1, +12.7] | [+2.4, +14.8] | ✅ |
| Gemini 3.8 Flash | Meta Muse Voice Transcribe | +8.9pp | [+5.3, +12.4] | [+2.9, +14.3] | ✅ |
| Gemini 3.8 Flash | Groq Whisper large-v3 | +11.1pp | [+7.9, +14.4] | [+5.8, +16.2] | ✅ |
| Gemini 3.8 Flash | Apple DictationTranscriber | +19.8pp | [+15.3, +24.7] | [+11.7, +27.0] | ✅ |
| Gemini 3.8 Flash | xAI Grok STT | +27.1pp | [+23.0, +31.2] | [+20.5, +34.1] | ✅ |
| Gemini 3.8 Flash (no thinking) | Apple SpeechTranscriber | +4.6pp | [+0.7, +8.7] | [-1.7, +11.7] | 🔸 |
| Gemini 3.8 Flash (no thinking) | Gemini 3.5 Transcribe | +5.4pp | [+1.4, +9.5] | [-1.0, +12.6] | 🔸 |
| Gemini 3.8 Flash (no thinking) | Meta Muse Voice Transcribe | +5.5pp | [+1.4, +9.6] | [-1.9, +12.4] | 🔸 |
| Gemini 3.8 Flash (no thinking) | Groq Whisper large-v3 | +7.4pp | [+3.3, +11.8] | [+1.0, +14.4] | ✅ |
| Gemini 3.8 Flash (no thinking) | Apple DictationTranscriber | +16.4pp | [+11.6, +21.2] | [+8.8, +24.0] | ✅ |
| Gemini 3.8 Flash (no thinking) | xAI Grok STT | +23.7pp | [+19.3, +28.2] | [+16.7, +30.6] | ✅ |
| Apple SpeechTranscriber | Gemini 3.5 Transcribe | +0.8pp | [-2.6, +4.3] | [-5.0, +6.5] | ➖ |
| Apple SpeechTranscriber | Meta Muse Voice Transcribe | +1.0pp | [-2.5, +4.4] | [-4.6, +6.8] | ➖ |
| Apple SpeechTranscriber | Groq Whisper large-v3 | +3.2pp | [-0.2, +6.8] | [-1.8, +9.3] | ➖ |
| Apple SpeechTranscriber | Apple DictationTranscriber | +11.8pp | [+8.8, +15.1] | [+6.3, +17.2] | ✅ |
| Apple SpeechTranscriber | xAI Grok STT | +19.1pp | [+15.4, +23.0] | [+13.3, +26.0] | ✅ |
| Gemini 3.5 Transcribe | Meta Muse Voice Transcribe | +0.2pp | [-3.2, +3.3] | [-5.6, +5.1] | ➖ |
| Gemini 3.5 Transcribe | Groq Whisper large-v3 | +2.1pp | [-1.2, +5.3] | [-3.0, +6.9] | ➖ |
| Gemini 3.5 Transcribe | Apple DictationTranscriber | +11.0pp | [+7.1, +14.9] | [+4.6, +17.1] | ✅ |
| Gemini 3.5 Transcribe | xAI Grok STT | +18.3pp | [+14.6, +22.2] | [+12.5, +24.6] | ✅ |
| Meta Muse Voice Transcribe | Groq Whisper large-v3 | +2.2pp | [-1.0, +5.6] | [-2.9, +7.5] | ➖ |
| Meta Muse Voice Transcribe | Apple DictationTranscriber | +10.9pp | [+6.7, +15.2] | [+4.4, +17.6] | ✅ |
| Meta Muse Voice Transcribe | xAI Grok STT | +18.1pp | [+14.7, +21.8] | [+12.9, +23.9] | ✅ |
| Groq Whisper large-v3 | Apple DictationTranscriber | +8.4pp | [+3.9, +13.0] | [+1.8, +15.7] | ✅ |
| Groq Whisper large-v3 | xAI Grok STT | +15.6pp | [+12.0, +19.4] | [+9.9, +21.2] | ✅ |
| Apple DictationTranscriber | xAI Grok STT | +7.3pp | [+2.7, +11.8] | [+0.3, +14.9] | ✅ |

> Every pair, not just rank-adjacent ones - a chain of indistinguishable neighbours says nothing about the models at the two ends. Paired bootstrap of the per-sample difference (same audio for every model), Bonferroni-adjusted for the number of pairs, plus an exact McNemar test per axis.

Discriminating samples: **120 / 122** · Proposition recall 84/122 · Proposition precision 87/122

## Token Usage & Cost

| Model | ASR in | ASR out | ASR cost | Judge in | Judge out | Judge cost | Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Gemini 3.8 Flash** | 281,808 | 160,028 | $0.8115 | 2,945,370 | 603,911 | $0.8376 | $1.65 |
| **Gemini 3.8 Flash (no thinking)** | 281,808 | 20,918 | $0.2898 | 2,864,271 | 557,527 | $0.7830 | $1.07 |
| **Gemini 3.5 Transcribe** | 281,807 | - | ~$0.9324 | 2,786,718 | 704,239 | $0.9536 | $1.89 |
| **Groq Whisper large-v3** | - | - | $0.3202 | 2,830,468 | 791,757 | $1.08 | $1.40 |
| **Meta Muse Voice Transcribe** | - | - | $0.5564 | 2,958,848 | 809,577 | $1.10 | $1.65 |
| **xAI Grok STT** | - | - | $0.3091 | 2,755,423 | 919,710 | $1.21 | $1.52 |
| **Apple SpeechTranscriber** | - | - | - | 2,979,954 | 378,425 | $0.5700 | - |
| **Apple DictationTranscriber** | - | - | - | 2,929,701 | 424,981 | $0.6213 | - |
| **TOTAL** | | | **-** | | | **$7.15** | **-** |

## Experiment Conditions

| Model | Provider | Request parameters |
| :--- | :--- | :--- |
| **Gemini 3.8 Flash** | gemini | `model`: gemini-3.8-flash<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: provider default<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Gemini 3.8 Flash (no thinking)** | gemini | `model`: gemini-3.8-flash<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: 0<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Gemini 3.5 Transcribe** | gemini | `model`: gemini-3.5-transcribe<br>`endpoint`: generativelanguage.googleapis.com/v1beta:generateContent<br>`prompt`: Please transcribe the speech in this audio verbatim in Japanese. Do not add any preamble, explanation, or notes. Output only the transcribed text.<br>`temperature`: provider default<br>`thinkingBudget`: provider default<br>`thinkingLevel`: provider default<br>`maxOutputTokens`: provider default |
| **Groq Whisper large-v3** | groq | `model`: whisper-large-v3<br>`endpoint`: https://api.groq.com/openai/v1/audio/transcriptions<br>`language`: ja<br>`response_format`: json<br>`temperature`: provider default<br>`prompt`: (none) |
| **Meta Muse Voice Transcribe** | meta | `model`: muse-voice-transcribe-1.0<br>`endpoint`: https://api.meta.ai/v1/asr/transcribe<br>`mode`: DIARIZATION<br>`audioEncoding`: WAV<br>`languageBias`: Japanese<br>`keywords`: <br>`preprocessing`: ffmpeg -ac 1 -ar 16000 -c:a pcm_s16le |
| **xAI Grok STT** | xai | `model`: grok-stt<br>`endpoint`: https://api.x.ai/v1/stt<br>`language`: ja<br>`prompt`: (none) |
| **Apple SpeechTranscriber** | apple | `framework`: SpeechAnalyzer<br>`model`: SpeechTranscriber<br>`locale`: ja-JP<br>`preset`: transcription<br>`processing`: on-device<br>`hardware`: Apple M1 Pro, 32 GB RAM<br>`timing`: analyze+finalize (excludes helper launch, asset checks, and queue wait) |
| **Apple DictationTranscriber** | apple | `framework`: SpeechAnalyzer<br>`model`: DictationTranscriber<br>`locale`: ja-JP<br>`preset`: longDictation<br>`processing`: on-device<br>`hardware`: Apple M1 Pro, 32 GB RAM<br>`timing`: analyze+finalize (excludes helper launch, asset checks, and queue wait) |

_Generated by `kikitori publish` from run `run_2026-09-08T02-40-45-884Z+run_2026-09-10T02-08-16-153Z+run_2026-09-10T07-19-02-111Z` on 2026-09-10, at github.com/ainoya/kikitori-bench @ `39a8c0a`._
