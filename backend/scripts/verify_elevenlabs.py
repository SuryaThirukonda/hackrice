"""Verify the configured ElevenLabs voice with one short, cached phrase."""
from __future__ import annotations

import asyncio

from app.config import BACKEND_DIR, Config
from app.voice.tts import ElevenLabsTTS


async def main() -> None:
    config = Config.load()
    tts_config = config.get("voice.tts")
    engine = ElevenLabsTTS(
        config.elevenlabs_key,
        (BACKEND_DIR / tts_config["cache_dir"]).resolve(),
        tts_config["model_id"],
        tts_config["output_format"],
        float(tts_config["timeout_s"]),
    )
    try:
        result = await engine.synth(
            config.get("voice.voices.announcer_a"),
            "Player One is ready to tee off.",
        )
    finally:
        await engine.close()
    print({
        "ok": result.get("url") is not None,
        "cached": result.get("cached", False),
        "url": result.get("url"),
        "error": result.get("error"),
    })


if __name__ == "__main__":
    asyncio.run(main())
