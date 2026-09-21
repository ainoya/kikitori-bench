#!/usr/bin/env python3
"""Transcribe one audio file with an mlx-audio speech-to-text model.

Prints a single JSON object on stdout:

    {"transcript": ..., "transcriptionMs": ..., "modelLoadMs": ...,
     "promptTokens": ..., "generationTokens": ...}

`transcriptionMs` covers generation only, so the benchmark's latency and RTF
exclude loading the weights - which this process pays on every call, while a
hosted API amortises it across requests. The load time is reported separately
rather than hidden.

Everything the library writes to stdout (progress bars, download notices) is
redirected to stderr so the JSON object is the only thing on stdout.
"""

import argparse
import contextlib
import json
import sys
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", help="Path of the audio file to transcribe")
    parser.add_argument("--model", required=True, help="Hugging Face model id or local path")
    parser.add_argument("--language", help="Language name the model advertises, e.g. Japanese")
    parser.add_argument("--prompt", help="System prompt / transcription instruction")
    parser.add_argument(
        "--hotword",
        action="append",
        default=[],
        dest="hotwords",
        help="Vocabulary biasing term; repeat for several",
    )
    parser.add_argument("--max-tokens", type=int, help="Maximum new tokens per chunk")
    parser.add_argument("--chunk-duration", type=float, help="Chunk length in seconds")
    parser.add_argument(
        "--batch-size",
        type=int,
        help="Audio chunks decoded in parallel",
    )
    parser.add_argument("--temperature", type=float, help="Sampling temperature")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    options = {
        "language": args.language,
        "system_prompt": args.prompt,
        "hotwords": args.hotwords or None,
        "max_tokens": args.max_tokens,
        "chunk_duration": args.chunk_duration,
        "batch_size": args.batch_size,
        "temperature": args.temperature,
    }
    options = {key: value for key, value in options.items() if value is not None}

    # stdout belongs to the JSON result; the library may write to it freely.
    with contextlib.redirect_stdout(sys.stderr):
        from mlx_audio.stt import load

        load_started = time.perf_counter()
        model = load(args.model)
        model_load_ms = (time.perf_counter() - load_started) * 1000

        generate_started = time.perf_counter()
        result = model.generate(args.audio, **options)
        transcription_ms = (time.perf_counter() - generate_started) * 1000

    json.dump(
        {
            "transcript": result.text,
            "transcriptionMs": round(transcription_ms),
            "modelLoadMs": round(model_load_ms),
            "promptTokens": getattr(result, "prompt_tokens", 0) or 0,
            "generationTokens": getattr(result, "generation_tokens", 0) or 0,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
