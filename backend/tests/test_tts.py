import httpx
import pytest

from app.voice.moderation import moderate
from app.voice.tts import ElevenLabsTTS, OfflineTTS, cache_key


@pytest.mark.asyncio
async def test_elevenlabs_cache_miss_hit_and_timeout(tmp_path):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        assert request.headers["xi-api-key"] == "k" and request.url.params["output_format"] == "mp3_44100_128"
        return httpx.Response(200, content=b"ID3fakeaudio")
    tts = ElevenLabsTTS("k", tmp_path, transport=httpx.MockTransport(handler))
    r1 = await tts.synth("v1", "Strike!")
    assert r1["url"] == f"/audio/{cache_key('v1', 'Strike!')}.mp3" and (tmp_path / f"{r1['cache_key']}.mp3").read_bytes() == b"ID3fakeaudio"
    r2 = await tts.synth("v1", "Strike!")
    assert r2["cached"] and calls["n"] == 1

    def failing(request):
        raise httpx.ReadTimeout("slow")
    tts2 = ElevenLabsTTS("k", tmp_path, transport=httpx.MockTransport(failing))
    r3 = await tts2.synth("v1", "Gutter.")
    assert r3["url"] is None and "slow" in r3["error"] and r3["duration_ms"] > 0


@pytest.mark.asyncio
async def test_offline_tts_serves_cache_only(tmp_path):
    tts = OfflineTTS(tmp_path)
    miss = await tts.synth("v", "hello")
    assert miss["url"] is None and not miss["cached"]
    (tmp_path / f"{cache_key('v', 'hello')}.mp3").write_bytes(b"x")
    hit = await tts.synth("v", "hello")
    assert hit["url"].endswith(".mp3") and hit["cached"]


def test_moderation():
    assert moderate("  Is that   all you've got?  ") == "Is that all you've got?"
    assert moderate("go kill yourself", blocklist=["kill yourself"]) is None
    assert moderate("Nice roll, Surya Thirukonda!", protected_names=["Surya Thirukonda"]) == "Nice roll, you!"
    long = moderate("word " * 40, max_chars=30)
    assert len(long) <= 31 and long.endswith("…")
