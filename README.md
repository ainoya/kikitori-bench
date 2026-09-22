# kikitori-bench

A private benchmark for **Japanese** speech-to-text, scored by an LLM-as-a-judge against
per-claim checklists instead of Word Error Rate.

## Why this exists

I built this to choose the transcription engine for [Ayumi](https://ayumi.femto-cloud.com/capture/),
my voice-journaling app. Picking an engine meant comparing candidates on the audio Ayumi
actually receives - unscripted Japanese dictation, recorded on a phone, full of names,
numbers and half-finished sentences, mostly a single speaker but with the occasional
passage of conversation - and the standard metrics could not tell me what I needed to know.

**WER and CER do not work well for Japanese.** There are no word boundaries, so word error
rate mostly measures the tokenizer. Character error rate is dominated by orthographic noise:
kanji vs kana, okurigana, punctuation the model may or may not emit. Both charge only a
few characters when a common idiom is transcribed as a string of similar-sounding
syllables that is not Japanese at all - the same price as a harmless spelling variant,
even though one destroys the sentence and the other does not. When I read the
transcripts by hand, the ranking I formed had almost nothing to do with what CER said.

So the benchmark measures what I actually care about when I read back a journal entry:

- **Did it keep the propositions I stated?** (recall) and **did it assert things I never
  said?** (precision) - judged claim by claim, so a single slip in a 90-second recording
  does not collapse the whole sample to zero.
- **Did it get names and numbers right?** - scored deterministically, because a name
  transcribed as a different name is wrong even when the sentence reads perfectly.

Neither WER nor CER is computed at all. Catastrophic output is caught structurally instead:
an empty transcript scores zero and is counted separately in the report, and a request the
provider rejects is recorded as an error rather than silently scored as a bad transcript.

## Dataset

The corpus this was developed against is **private and stays private**, so it is not
part of this repository and the results below are not independently reproducible.
Audio, transcripts, run artefacts and reports are all git-ignored; only the synthetic
`demo` dataset is committed, as a template for the file format. Point the tooling at
your own recordings and it works the same way.

## Results (September 2026)

122 samples, 3h 05m of Japanese speech per model, every sample under 10 minutes so that
every provider sees the same set. Judged by `gpt-5.6-luna` at reasoning effort `low`.
Overall = proper-noun F1 x 0.30 + proposition F1 x 0.70. Full tables, confidence intervals
and pairwise tests: **[docs/results.md](docs/results.md)**.

| # | Model | Overall | 95% CI | Proper nouns | Recall | Precision | RTF | ASR cost / audio hour |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | Gemini 3.8 Flash | **76.1%** | [71.5, 80.4] | 62.8% | 87.5% | 83.8% | 0.06x | $0.214 |
| 2 | Gemini 3.8 Flash (thinking off) | 71.1% | [65.8, 76.3] | 58.6% | 81.0% | 80.7% | 0.04x | $0.093 |
| 3 | Qwen3.8-Omni-Flash | 70.8% | [66.5, 75.0] | 53.7% | 81.8% | 80.7% | 0.17x | $0.025 |
| 4 | Qwen3.8-Omni-Flash (thinking off) | 69.8% | [65.6, 73.9] | 48.4% | 82.2% | 82.7% | 0.06x | **$0.007** |
| 5 | Gemini 3.5 Transcribe | 69.2% | [64.7, 73.6] | 52.8% | 79.1% | 78.8% | 0.03x | $0.302 |
| 6 | Meta Muse Voice Transcribe | 68.4% | [64.7, 72.0] | 40.1% | 81.2% | 86.1% | 0.16x | $0.180 |
| 7 | Apple SpeechTranscriber | 68.4% | [64.4, 72.1] | 41.1% | 80.8% | 87.6% | **0.01x** | on-device |
| 8 | Groq Whisper large-v3 | 66.4% | [62.2, 70.5] | 47.3% | 78.7% | 79.4% | 0.12x | $0.111 |
| 9 | Qwen3-ASR 1.7B (MLX, 8-bit) | 63.2% | [58.9, 67.2] | 34.1% | 78.6% | 81.4% | 0.12x | on-device |
| 10 | Grok Voice Transcribe 2.0 | 63.2% | [58.4, 67.8] | 46.2% | 72.6% | 77.5% | 0.02x | $0.100 |
| 11 | Qwen3-ASR 0.6B (MLX, 8-bit) | 57.8% | [53.1, 62.3] | 34.4% | 71.6% | 75.4% | 0.05x | on-device |
| 12 | Apple DictationTranscriber | 57.1% | [52.1, 62.1] | 44.0% | 62.7% | 78.6% | 0.03x | on-device |
| 13 | Grok Voice Transcribe 1.0 | 49.6% | [44.8, 54.5] | 23.6% | 61.7% | 70.2% | 0.02x | $0.100 |

![Price versus score](docs/charts/price-performance.svg)

![Speed versus score](docs/charts/speed-performance.svg)

![Score by evaluation axis](docs/charts/score-breakdown.svg)

What the numbers said, for my use case:

- **Gemini 3.8 Flash leads**, and every gap below it except its own thinking-off variant,
  Qwen3.8-Omni-Flash and Meta Muse survives a Bonferroni correction over all 78 pairs.
- **Thinking buys little here, on either engine.** Turning it off costs Gemini 5.0pp (95% CI
  [+1.5, +8.9], which the multiple-comparison adjustment widens to [-0.1, +12.3]) and saves
  56% of the spend and a third of the latency. On Qwen3.8-Omni-Flash it costs 1.0pp
  ([-1.3, +3.1], not distinguishable) and saves 73% of the spend.
- **Qwen3.8-Omni-Flash resets the price floor.** Third at 70.8%, with its thinking-off
  variant fourth at 69.8%; neither is distinguishable from Gemini 3.8 Flash with thinking
  off (+0.3pp and +1.2pp). What changed is the price. The provider meters audio at 7 tokens
  per second and bills it at the text input rate, which puts an audio hour at $0.025 with
  thinking and $0.007 without - against $0.093 for the cheapest engine measured before it.
  Thinking off is the configuration to use: 85% of the thinking variant's output tokens are
  reasoning tokens, and they buy 1.0pp. The cost is speed, not quality - 0.17x RTF with
  thinking is the slowest in the field, though 0.06x without it is mid-pack.
- **On-device is competitive, for free.** Apple SpeechTranscriber ties Meta Muse for sixth
  at the lowest latency in the field, and Qwen3-ASR 1.7B on MLX lands within 3.2pp of Groq
  Whisper (95% CI [+0.1, +6.5] - not distinguishable once adjusted). Neither costs anything
  per hour, which the price chart cannot show, so they are excluded from it.
- **A generation of Grok is worth 13.6pp.** Voice Transcribe 2.0 scores 63.2% against 1.0's
  49.6% (95% CI [+10.4, +17.1], significant adjusted) at the same $0.100 per audio hour -
  the largest jump between two versions of anything measured here, and most of it is proper
  nouns, which go from 23.6% to 46.2%. That moves Grok from last place to mid-field, level
  with Qwen3-ASR 1.7B (+0.0pp, [-4.0, +4.0]) and no longer distinguishable from Groq Whisper.
  It is also the second-fastest engine in the field behind Apple, at 0.02x RTF and a 1811 ms
  p50. It does not reach the price/performance frontier, though: Qwen3.8-Omni-Flash with
  thinking off is 14x cheaper ($0.007/hr) and 6.6pp better.
- **Local models pay for it in proper nouns.** Both Qwen3-ASR sizes score ~34% there, the
  weakest in the field apart from Grok Voice Transcribe 1.0, while their proposition scores
  sit mid-pack. Going from 0.6B to 1.7B buys 5.4pp overall (95% CI [+2.2, +8.9]) entirely on
  the proposition side - proper nouns do not improve at all.
- **Meta Muse rejects audio longer than 10 minutes.** Those samples are excluded here to keep
  the comparison fair; it is still a hard constraint in production.
- **Pin the model id, not the alias.** xAI's `grok-stt` is a pointer to the current default,
  and it resolved to 1.0 while this run was measured - the two returned byte-identical
  transcripts. The 1.0 row therefore records `grok-stt` as the parameter it was actually sent;
  both config entries now name an explicit version so a provider-side move cannot silently
  change what a row means.
- Every model ran with identical request parameters, all recorded in the run manifest, and
  every hypothesis was judged in one run at the same reasoning effort.

Regenerate this summary and the charts from a finished run with:

```bash
pnpm kikitori publish <run_id>
```

It reads only aggregate fields - leaderboard, statistics, token counts, costs - so no
sample id or transcript can reach the published output.

## Disclaimer

**The dataset cannot be published.** The corpus is private, so only the aggregate results
above are shared. That means these numbers are **not independently reproducible**: you can
run the same tooling, but not on the same audio.

Please treat the table as one person's evidence for one decision, not as a vendor-neutral
leaderboard, and **use the numbers at your own risk**:

- **Mostly one speaker, one language, one recording setup.** The corpus is predominantly
  single-speaker dictation with a few conversational passages, so the scores reflect one
  voice, one vocabulary and one microphone. Nothing here measures how these engines handle
  meetings, multi-party audio or speaker attribution. Your audio will rank differently.
- **The judge is an LLM.** Measured self-consistency was Cohen's kappa 0.81 on re-judged
  samples, and agreement with a human reviewer was kappa 0.84 over a 30-item audit - good,
  but not an oracle. Differences smaller than a few points are noise. Those two figures were
  measured before the judge's reasoning effort was pinned to `low`, so they describe the
  method rather than this exact run.
- **Prices are list prices at the time of the run** (September 2026) and are recomputed from a
  price list in `kikitori.config.yaml`; they go stale.
- **Model versions move.** A result here describes a model on a given day, nothing more.

No warranty of any kind. If a decision matters to you, run the benchmark on your own audio.

---

## Features

- **Fully private.** Audio and transcripts stay in your local environment; `.gitignore` and
  `pnpm check:leaks` keep them out of commits.
- **Claim-level evaluation with an LLM-as-a-judge** (Codex App Server / GPT-5.6 Luna). The
  judge rules on each `key_point` individually - **present**, **missing** or **contradicted**,
  with a critical/minor severity - and lists assertions the hypothesis makes that the ground
  truth does not support. Those become **proposition recall** (did it keep what was said) and
  **proposition precision** (did it invent anything), combined with F-beta; `scoring.fBeta`
  decides whether an omission or a fabrication weighs more (default: equal). Judging per claim
  rather than per clip keeps the score resolving on long recordings, where a single slip would
  otherwise fail the whole sample. Every verdict is stored with its rationale and evidence.
- **Deterministic proper-noun scoring.** Names, numbers and coined words are extracted from the
  reference and the hypothesis with the same local morphological analyser (kuromoji, no API)
  and compared as sets, giving recall, precision and F1. A name transcribed as a different name
  is wrong even when the sentence reads perfectly, so this axis never goes through the LLM.
- **Ground truth drafting and key-point refinement with Gemini.** Draft transcripts from audio,
  then re-derive `key_points` from a verified transcript at a granularity computed from the
  audio length (`kikitori dataset refine`).
- **Human-in-the-loop review web UI.** Listen to audio (speed control, seeking), edit ground
  truth, adjust key points, and verify samples with one-key shortcuts. English and Japanese.
- **Side-by-side transcript comparison.** Read the ground truth and every model's
  hypothesis in parallel columns for one sample at a time, with a character-level diff
  against the reference, expected-term hits and misses per model, and the judge score,
  latency and RTF in each column header (`kikitori compare`). Models benchmarked in
  separate runs are merged into one set of columns, ordered by score. English and Japanese.
- **Recorded experiment conditions.** Every run stores the resolved request parameters of each
  model - prompt, language, temperature, thinking budget, response format, diarization mode,
  biasing, audio preprocessing - plus judge settings and scoring weights. Unset values are
  recorded as `provider default`, so a report always states the condition it was produced under.
- **Token usage and cost accounting.** Per-request consumption for both the ASR call and the
  judge turn, converted to USD from the price list in `kikitori.config.yaml`, covering
  token-billed and audio-duration-billed providers alike. Costs are recomputed from stored
  usage on every report, so editing prices re-prices past runs.
- **Statistical reliability.** Bootstrap confidence intervals, all pairwise comparisons with a
  multiple-comparison adjustment, exact McNemar tests per axis, latency percentiles, and an
  item analysis showing which samples actually discriminate between models.
- **Pluggable ASR adapters.** Apple SpeechTranscriber (on-device), Qwen3-ASR on Apple MLX
  through mlx-audio (on-device), Grok Voice Transcribe, Gemini 3.8 Flash, Gemini 3.5 Transcribe,
  Meta Muse Voice Transcribe, Groq-hosted Whisper, OpenAI Whisper, plus generic HTTP endpoints
  and local CLI commands.

---

## Prerequisites & Setup

### Tooling
This project requires **mise** (Node v26) and **pnpm**.
`ffmpeg` must also be on `PATH` for the Meta Muse and mlx-audio adapters, which read WAV input (other formats are transcoded on the fly).

```bash
# Trust project configuration
mise trust

# Install tools (Node v26, pnpm)
mise install

# Install dependencies (the `prepare` script patches the local TypeScript and
# oxlint binaries so the Effect language service is active, and installs the
# lefthook Git hooks)
pnpm install

# Run strict type checking
pnpm typecheck
```

To use the optional Apple SpeechTranscriber adapter, install macOS 26 and Xcode 26 or newer,
then build its Swift helper and install the Japanese on-device model once. Do this before
measuring so model download/build time is not counted as ASR latency:

```bash
pnpm apple:prepare
```

`apple-dictation` uses a separate, older on-device dictation model. Install its assets only when
you want to benchmark that model independently:

```bash
pnpm apple:prepare:dictation
```

For Apple models, RTF is timed inside the Swift helper around SpeechAnalyzer analysis,
finalization, and result collection. Helper-process launch, asset checks, audio-file opening, and
waiting for another Apple transcription are excluded. Because transcription runs on-device, the
resolved run conditions also record the host processor and memory; compare Apple RTF only with
that hardware, OS, and installed speech-model assets in mind.

To use the optional mlx-audio adapter - Qwen3-ASR running locally on Apple Silicon through
[mlx-audio](https://github.com/Blaizzy/mlx-audio) - create its Python environment once
(needs [uv](https://docs.astral.sh/uv/) and Python 3.12):

```bash
pnpm mlx:prepare
```

The weights are pulled from Hugging Face on first use and cached under `~/.cache/huggingface`;
download them before measuring so the first sample is not timed with a download in it:

```bash
tools/mlx-audio/.venv/bin/python -c "from mlx_audio.stt import load; load('mlx-community/Qwen3-ASR-1.7B-8bit')"
```

`model` in the config is the Hugging Face id, so any model mlx-audio can load works here
(`mlx-community/Qwen3-ASR-0.6B-8bit`, other quantizations, a local path). Set
`MLX_AUDIO_PYTHON` when the interpreter lives outside `tools/mlx-audio/.venv`.

Latency for this adapter is generation only: the helper process loads the weights on every
sample - a hosted API amortises that across requests - so the load time is measured separately
and left out of RTF. As with the Apple adapter, local models are run one at a time, so a
`--concurrency` above 1 still serializes them, and their RTF only means something alongside
the host processor recorded in the run conditions.

### Environment variables
Copy `.env.example` to `.env` and configure your API keys:

```bash
cp .env.example .env
```

Configuration items in `.env`:
```ini
# xAI API Key for Grok Voice Transcribe
XAI_API_KEY=your_xai_api_key

# Gemini API Key (for drafting and Gemini ASR)
GEMINI_API_KEY=your_gemini_api_key

# Groq API Key (for Groq-hosted Whisper large-v3)
GROQ_API_KEY=your_groq_api_key

# Meta API Key (for Muse Voice Transcribe)
META_API_KEY=your_meta_api_key

# OpenAI API Key (for Whisper ASR)
OPENAI_API_KEY=your_openai_api_key

# Optional: Python interpreter for the mlx-audio adapter
# (default: tools/mlx-audio/.venv/bin/python, created by 'pnpm mlx:prepare')
MLX_AUDIO_PYTHON=/path/to/python

# Codex App Server (for the GPT-5.6 Luna judge)
CODEX_APP_SERVER_URL=ws://127.0.0.1:4500
CODEX_APP_SERVER_MODEL=gpt-5.6-luna

# Obsidian vault directory for 'dataset import-journal' (personal path, never committed)
JOURNAL_VAULT_DIR=/path/to/your/vault/journal/2026

# Local Review Web UI port. The comparison UI ('kikitori compare') defaults to
# REVIEW_PORT + 1, so both can stay open at once.
REVIEW_PORT=3000
```

---

## Benchmark Workflow

### Initialize a dataset and add audio
```bash
# Create a new dataset
pnpm kikitori dataset init my_dataset_ja -d "Internal Audio Benchmark"
```
Place your private audio files (`.wav`, `.mp3`, `.m4a`, etc.) into `datasets/my_dataset_ja/audio/`.

```bash
# Scan audio directory and register files in dataset.yaml
pnpm kikitori dataset scan my_dataset_ja
```

---

### Draft ground truth with Gemini (optional)
Generate draft transcripts and key points from the audio, as a starting point for review.
(The drafter also proposes `expected_terms`; they are kept for reference only - proper nouns
are scored by the deterministic extractor, not from that list.)

```bash
pnpm kikitori dataset draft my_dataset_ja --concurrency 2
```

---

### Refine the key points

The score resolves per claim, so the granularity of `key_points` sets the resolution of the
benchmark. This re-derives them from the verified transcript, with a target count computed
from each recording's length:

```bash
pnpm kikitori dataset refine my_dataset_ja
```

---

### Review and verify in the web UI
Listen to audio in your browser, review/edit transcripts and terms, and mark samples as verified:

```bash
pnpm kikitori review my_dataset_ja
# Opens http://localhost:3000?dataset=my_dataset_ja
# Shortcut: Cmd + Enter (Ctrl + Enter) to approve and proceed to the next item
```

---

### Run the ASR models
Execute transcription across verified samples using your chosen ASR models:

```bash
# Run specific models (e.g., Apple, Qwen3-ASR on MLX, Grok, Gemini, Meta Muse, Groq Whisper)
pnpm kikitori run my_dataset_ja -m apple-speech qwen3-asr-1.7b qwen3-asr-0.6b xai-grok-2 gemini-flash gemini-transcribe meta-muse groq-whisper

# Offline / dry-run test using mock model
pnpm kikitori run my_dataset_ja -m mock --all
```
Results are saved to `runs/<run_id>/asr_results.json`.

---

### Evaluate with the judge
With Codex App Server running, evaluate the ASR hypotheses against the Ground Truth:

```bash
# Start Codex App Server in another terminal
codex app-server --listen ws://127.0.0.1:4500

# Run evaluation
pnpm kikitori eval my_dataset_ja --run run_2026-09-07T07-04-39-940Z

# (For offline testing with mock judge)
pnpm kikitori eval my_dataset_ja --run <run_id> --mock-judge
```

---

### Compare the transcripts side by side
Read the ground truth and every model hypothesis in parallel columns, one sample at a time:

```bash
pnpm kikitori compare                                  # newest run under runs/
pnpm kikitori compare run_2026-09-07T07-04-39-940Z     # a specific run
pnpm kikitori compare <run_a> <run_b>                  # merge runs into one set of columns
pnpm kikitori compare -d my_dataset_ja                 # every model of a dataset
# Opens http://localhost:3001?run=<run_id> (REVIEW_PORT + 1, or -p to choose)
```

A model set is rarely all in one run - a provider added later is benchmarked separately
over the same samples - so several runs can be merged into one set of columns. `--dataset`
does that resolution for you: it takes each model from the **newest evaluated run that
contains it**, skipping the mock adapter, and prints which runs it merged. Merging all runs
blindly would let a stale run supply a model's hypotheses, which is the one comparison a
reader would misread. Runs from different datasets are refused, since the ground truth
would differ.

The ground truth column is pinned on the left, then one column per model. Per column the
header carries the judge score (when the run has been evaluated), latency, RTF, character
count, and how many `expected_terms` the hypothesis contains, with the missing ones listed
as chips. **Order** sorts the columns by mean judge score - leaderboard order, computed
over the whole run so columns do not jump around between samples - or by run order.

- **Diff vs GT** renders a character-level diff against the ground truth: text the model
  invented is marked, text it dropped stays visible struck through, and the header gains a
  match percentage. It is computed in the browser, so nothing leaves the machine.
- **Highlight terms** marks every `expected_terms` occurrence in all columns.
- Model columns can be hidden individually, the column width and text size are adjustable,
  and **Sync scroll** keeps long transcripts lined up while reading across. The header's run
  picker switches between the merged set and any single run.
- `j` / `k` (or the arrow keys) move between samples, `d` toggles the diff, space plays the
  audio.

The view is read-only: correcting a transcript is still the job of `kikitori review`.

---

### Or run the whole pipeline at once
Execute the entire pipeline (ASR execution -> judge evaluation -> Leaderboard generation) in a single step:

```bash
pnpm kikitori benchmark my_dataset_ja -m apple-speech xai-grok gemini-flash gemini-transcribe meta-muse groq-whisper
```

---

## Output

A formatted leaderboard is printed directly to the terminal, and a comprehensive markdown report with evidence citations is generated under `reports/<run_id>.md`.

### Terminal leaderboard
```
=====================================================================================
  KIKITORI-BENCH LEADERBOARD
  Dataset: my_dataset_ja | Judge: gpt-5.6-luna | Run: run_2026-09-08T02-40-45-884Z
=====================================================================================
Rank  | Model                |   Overall |     Names |     Recall |  Precision |       F1
-------------------------------------------------------------------------------------
#1    | Gemini 3.8 Flash     |     75.1% |     65.9% |      86.2% |      79.1% |    81.1%
#2    | Gemini 3.8 Flash (no |     71.7% |     56.0% |      84.6% |      80.8% |    80.8%
#3    | Gemini 3.5 Transcrib |     66.3% |     52.8% |      77.2% |      74.0% |    74.7%
=====================================================================================
```

### Report contents
- **Aggregate Leaderboard**: Weighted overall score, per-axis breakdown, average latency, total cost.
- **Reliability**: Bootstrap confidence intervals, every pairwise comparison (Bonferroni-adjusted) with an exact McNemar test on the
  check-backed axes, latency percentiles, and an item analysis showing which samples actually discriminate between models.
- **Experiment Conditions**: Judge model / endpoint / temperature, scoring weights, sample count, and the resolved request parameters of every model.
- **Token Usage & Cost**: Per-model audio length, ASR input tokens (audio/text), ASR output tokens, ASR cost, judge input tokens (cached), judge output tokens (reasoning), judge cost, and the run total. `~` marks a cost estimated from audio length when the provider reports no token counts.
- **Per-Sample Detailed Evaluations**:
  - Ground Truth text
  - Model hypothesis
  - Itemized checks (PASS / FAIL badge, rationale, quoted excerpt evidence).

---

## Configuration (`kikitori.config.yaml`)

- **Judge (`judge`)**: provider, model, endpoint and per-turn `timeoutMs` / `retries`, plus
  `reasoningEffort` - the reasoning effort each judge turn runs at (`low` is the lowest
  `gpt-5.6-luna` advertises). Leave it unset and the app server applies its own default, which
  follows the operator's `~/.codex/config.toml` rather than this benchmark; it is recorded in
  the run conditions either way. Scores from runs judged at different efforts are not strictly
  comparable.
- **Weights (`weights`)**: `proper_noun_f1` and `proposition_quality`, summing to 1.0. The overall score is not a plain weighted mean - recall and precision are combined with F-beta first, so a model cannot score well by transcribing almost nothing.
- **Scoring (`scoring.fBeta`)**: 1.0 treats an omission and a fabrication as equally bad; below 1 weights precision, above 1 weights recall.
- **Options (`options`)**: Per-model request parameters, recorded as the experiment condition of every run. Unset values keep the provider default:
  - `prompt`: transcription instruction / vocabulary biasing hint (Gemini, Whisper, Groq, xAI).
  - `language`: language or locale hint such as `ja` or `ja-JP` (Apple, Whisper, Groq, xAI).
  - `temperature`, `maxOutputTokens`: decoding controls.
  - `thinkingBudget` / `thinkingLevel`: Gemini thinking controls, both nested under
    `generationConfig.thinkingConfig`. `thinkingBudget: 0` disables thinking, which cuts output
    tokens and cost sharply. A top-level `thinkingLevel` is rejected by the API.
  - `responseFormat`: `json` / `verbose_json` / `text` (Whisper, Groq).
  - `mode`, `audioEncoding`, `languageBias`: Meta Muse Voice Transcribe settings.
  - `keywords`: vocabulary biasing - Meta Muse keywords, mlx-audio hotwords (folded into the
    model's system prompt).
  - `chunkSeconds`, `batchSegments`: mlx-audio chunking - the chunk length long audio is split
    into, and how many chunks are decoded in parallel. For mlx-audio, `language` is translated
    from the ISO code to the name the model conditions on (`ja` becomes `Japanese`), and an
    unrecognised value leaves the model auto-detecting.
- **Pricing (`pricing`)**: Optional per-model price list, also available under `judge` for the LLM-as-a-judge model. All rates are USD:
  - `inputPerMTok` / `cachedInputPerMTok` / `audioInputPerMTok` / `outputPerMTok`: per 1M tokens (token-billed models).
  - `perAudioHour` / `minBillableSeconds`: per hour of audio, with an optional minimum billed length per request (duration-billed STT APIs).
  - `estimateAudioTokensPerSecond` / `estimateOutputTokensPerMinute`: fallback ratios used to estimate cost when the provider omits token counts.
  - A model without a `pricing` block reports `-` for its ASR and combined costs and is excluded
    from the price/performance chart and Pareto frontier. Its judge cost remains visible, and the
    model remains in quality and speed comparisons. The on-device models - Apple
    SpeechTranscriber and Qwen3-ASR on MLX - intentionally have no pricing block: they run on
    hardware you already own, and an invented hourly rate would not compare with a provider's
    list price.
- **Models (`models`)**:
  - `apple`: Apple Speech framework on macOS 26+ (`speech-transcriber`, or `dictation` for the
    older on-device dictation model; each model needs its own prepared assets)
  - `mlx-audio`: local speech-to-text on Apple MLX, e.g. `mlx-community/Qwen3-ASR-1.7B-8bit`
    or `mlx-community/Qwen3-ASR-0.6B-8bit` (needs `pnpm mlx:prepare` and `ffmpeg`)
  - `xai`: xAI Grok Voice Transcribe (`grok-voice-transcribe-2.0`, `grok-voice-transcribe-1.0`;
    the `grok-stt` alias resolves to the provider's current default, so pin an explicit id)
  - `gemini`: Gemini ASR (`gemini-3.8-flash`, `gemini-3.5-transcribe`, ...)
  - `meta`: Meta Muse Voice Transcribe (`https://api.meta.ai/v1/asr/transcribe`, requires `ffmpeg`)
  - `groq`: Groq-hosted Whisper (OpenAI-compatible `/audio/transcriptions`)
  - `whisper`: OpenAI Whisper ASR
  - `custom-http`: Custom REST API endpoint
  - `custom-command`: Local command template (e.g. `whisper {audio_path}`)

---

## Commands

| Command | What it does |
| :--- | :--- |
| `dataset init <name>` | Create a dataset directory and manifest |
| `dataset scan <name>` | Register new audio files found in `datasets/<name>/audio/` |
| `dataset import-journal [dir]` | Import audio and transcripts from an Obsidian vault (`JOURNAL_VAULT_DIR`) |
| `dataset draft <name>` | Draft transcripts, terms and key points from audio with Gemini |
| `dataset refine <name>` | Re-derive `key_points` from verified transcripts at a length-aware granularity |
| `review <name>` | Local web UI for listening, editing and verifying |
| `compare [runs...]` | Local web UI comparing the ground truth and every model hypothesis side by side; merges runs, or use `-d <dataset>` |
| `run <name>` | Run the ASR models and store hypotheses; `--into <run>` adds a model to a finished run instead of opening a new one |
| `eval <name> --run <id>` | Judge a finished run; re-running retries only what is missing |
| `benchmark <name>` | `run` followed by `eval` |
| `repair <run>` | Retry the ASR requests that failed in a run and drop their stale judgements |
| `report <run>` | Regenerate the full local report, recomputing costs from the current price list |
| `rescore <run>` | Re-apply the current scoring formula and weights without calling the judge |
| `publish <run>` | Write the aggregate-only summary and standalone SVG charts to `docs/` |
| `judge-consistency <run>` | Re-judge a subsample to measure how much the judge disagrees with itself |
| `judge-audit <run>` | Export a worksheet of individual checks for human labelling, or score a filled one |

Common flags: `-m` selects models, `-l` limits the number of samples, `-d` skips samples
longer than N seconds, `-c` sets concurrency, `--lang en|ja` picks the report language.

To add one newly released model to a published comparison, transcribe it into the existing
run and judge it there, rather than re-measuring every model:

```bash
pnpm kikitori run my_dataset_ja -m new-model --into run_2026-09-21T09-00-00-000Z -d 600
pnpm kikitori eval my_dataset_ja --run run_2026-09-21T09-00-00-000Z
```

Both steps skip the (model, sample) pairs already on disk, so the earlier models keep the
hypotheses and judgements they were measured with. This is only comparable while the judge
condition is pinned - `judge.model` and `judge.reasoningEffort` must be what the run was
judged under, and the same `-d` cap must select the same samples.

---

## Development & Testing

```bash
# Check that nothing private is staged for commit: audio, transcripts, run
# artefacts, personal paths, API keys, or a phrase copied from the recordings
# into a comment or an example.
pnpm check:leaks

# Type check (strict TypeScript + Effect)
pnpm typecheck

# Lint (oxlint, including the type-aware Effect rules)
pnpm lint
pnpm lint:fix

# Format (oxfmt)
pnpm format
pnpm format:check

# Type check, lint and format check in one go
pnpm check

# Build distribution bundle
pnpm build

# Run CLI help
pnpm kikitori --help
```

The `pre-commit` hook (lefthook) runs the same checks against what you are about
to commit: it formats the staged TypeScript and re-stages it, then runs `lint`,
`typecheck` and `check:leaks`. `pnpm install` installs it; if the hook ever goes
missing, `pnpm exec lefthook install` puts it back.
