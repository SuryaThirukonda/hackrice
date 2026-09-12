"""Text-to-speech backends: ElevenLabs (cached mp3 on disk) and an offline cache-only backend."""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Protocol

import httpx


def cache_key(voice_id: str, text: str) -> str:
    return hashlib.sha1(f"{voice_id}|{text}".encode()).hexdigest()


class TTSBackend(Protocol):
    async def synth(self, voice_id: str, text: str) -> dict[str, Any]: ...


def _estimate_ms(text: str) -> int:
    return 400 + 60 * len(text)


class OfflineTTS:
    """Serves cached clips only; on a miss returns url=None so subtitles and queue timing still run."""

    def __init__(self, cache_dir: Path):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    async def synth(self, voice_id: str, text: str) -> dict[str, Any]:
        key = cache_key(voice_id, text)
        path = self.cache_dir / f"{key}.mp3"
        if path.exists():
            return {"url": f"/audio/{key}.mp3", "cache_key": key, "duration_ms": _estimate_ms(text), "cached": True}
        return {"url": None, "cache_key": key, "duration_ms": _estimate_ms(text), "cached": False}


class ElevenLabsTTS:
    def __init__(self, api_key: str, cache_dir: Path, model_id: str = "eleven_flash_v2_5", output_format: str = "mp3_44100_128", timeout_s: float = 3.0, transport: httpx.AsyncBaseTransport | None = None):
        self.api_key, self.model_id, self.output_format, self.timeout_s = api_key, model_id, output_format, timeout_s
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.client = httpx.AsyncClient(timeout=timeout_s, transport=transport)
        self.requests = 0

    async def synth(self, voice_id: str, text: str) -> dict[str, Any]:
        key = cache_key(voice_id, text)
        path = self.cache_dir / f"{key}.mp3"
        if path.exists():
            return {"url": f"/audio/{key}.mp3", "cache_key": key, "duration_ms": _estimate_ms(text), "cached": True}
        self.requests += 1
        try:
            r = await self.client.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}", params={"output_format": self.output_format},
                                       headers={"xi-api-key": self.api_key, "accept": "audio/mpeg"},
                                       json={"text": text, "model_id": self.model_id})
            r.raise_for_status()
            path.write_bytes(r.content)
            return {"url": f"/audio/{key}.mp3", "cache_key": key, "duration_ms": _estimate_ms(text), "cached": False}
        except (httpx.HTTPError, OSError) as e:
            return {"url": None, "cache_key": key, "duration_ms": _estimate_ms(text), "cached": False, "error": str(e)[:120]}

    async def close(self) -> None:
        await self.client.aclose()
