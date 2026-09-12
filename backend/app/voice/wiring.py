"""Voice module: triggers -> moderated line -> TTS (async) -> voice.line to the projector. One line in flight, priority replace."""
from __future__ import annotations

import asyncio
import inspect
import logging
import random
from pathlib import Path
from typing import Any

from ..arena import Intent
from ..config import BACKEND_DIR
from .moderation import moderate
from .triggers import load_triggers
from .tts import ElevenLabsTTS, OfflineTTS

log = logging.getLogger("hap.voice")


class VoiceModule:
    def __init__(self, arena, tts=None):
        self.arena = arena
        self.loop, self.state, self.config = arena.loop, arena.state, arena.config
        vc = self.config.section("voice")
        self.triggers = load_triggers(vc)
        self.voices: dict[str, str] = dict(vc.get("voices", {}))
        self.mod = vc.get("moderation", {})
        cache_dir = (BACKEND_DIR / vc.get("tts", {}).get("cache_dir", "../assets/audio/cache")).resolve()
        if tts is not None:
            self.tts = tts
        elif self.config.tts_enabled:
            t = vc.get("tts", {})
            self.tts = ElevenLabsTTS(self.config.elevenlabs_key, cache_dir, t.get("model_id", "eleven_flash_v2_5"), t.get("output_format", "mp3_44100_128"), float(t.get("timeout_s", 3.0)))
        else:
            self.tts = OfflineTTS(cache_dir)
        self.rng = random.Random()
        self.pending: dict[str, Any] | None = None       # line waiting for TTS
        self.in_flight: dict[str, Any] | None = None
        self.stale_ms = int(vc.get("playback", {}).get("stale_ms", 6000))
        self.spoken: list[dict[str, Any]] = []
        self.loop.on("voice.ready", self.on_ready)
        self.loop.on("host.unlock_audio", lambda i: self.loop.emit("host.ack", {"cmd": "unlock_audio", "ok": True}, to=["host", "projector"]))
        games = arena.modules.get("games.wiring")
        if games:
            games.on_trigger.append(self.on_trigger)
            games.on_decision.append(self.on_decision)

    # ---- inputs -------------------------------------------------------------------------------------
    def on_decision(self, match, req, option, source, line) -> None:
        if line and self.state.toggles.get("tts", True):
            self.say("taunt", {"line": line}, match, persona_line=line)

    def on_trigger(self, name: str, data: dict[str, Any], match) -> None:
        self.say(name, data, match)

    def say(self, name: str, data: dict[str, Any], match, persona_line: str | None = None) -> None:
        tr = self.triggers.get(name)
        if tr is None:
            return
        if tr.persona_line and not persona_line and name == "taunt":
            persona_line = self.rng.choice(match.tier.taunts) if match and match.tier.taunts else None
        text = persona_line if (tr.persona_line and persona_line) else tr.render(data, self.rng)
        protected = [n for n in (match.players.values() if match else [])]
        text = moderate(text, int(self.mod.get("max_chars", 90)), list(self.mod.get("blocklist", [])), protected)
        if not text:
            return
        speaker = tr.speaker
        voice_id = self.voices.get(speaker) if speaker != "opponent" else (match.tier.voice_id if match else "")
        item = {"id": f"v{len(self.spoken) + 1}_{self.rng.randrange(1000)}", "priority": tr.priority, "speaker": speaker, "text": text, "voice_id": voice_id or "",
                "requested_ms": self.loop.clock.now_ms(), "match_id": match.match_id if match else None, "trigger": name}
        # one pending at most; higher priority replaces; equal priority keeps the newer
        if self.pending is None or item["priority"] >= self.pending["priority"]:
            self.pending = item
        if self.in_flight is None:
            self._start_next()

    def _start_next(self) -> None:
        if self.pending is None:
            return
        item, self.pending = self.pending, None
        self.in_flight = item
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is None:
            # no event loop (headless tests): resolve synchronously with the offline backend semantics
            res = asyncio.run(self.tts.synth(item["voice_id"], item["text"]))
            self.loop.submit(Intent("voice.ready", {"item": item, "res": res}))
            return
        async def job():
            res = await self.tts.synth(item["voice_id"], item["text"])
            self.loop.submit(Intent("voice.ready", {"item": item, "res": res}))
        loop.create_task(job())

    def on_ready(self, i: Intent) -> None:
        item, res = i.d["item"], i.d["res"]
        self.in_flight = None
        age = self.loop.clock.now_ms() - item["requested_ms"]
        if age <= self.stale_ms or item["priority"] >= 3:
            payload = {"id": item["id"], "priority": item["priority"], "speaker": item["speaker"], "text": item["text"], "url": res.get("url"),
                       "duration_ms": res.get("duration_ms", 1500), "trigger": item["trigger"]}
            self.loop.emit("voice.line", payload, to="projector")
            self.spoken.append(payload)
            if self.arena.store is not None:
                self.arena.store.write("voice_lines", {"match_id": item["match_id"], "speaker": item["speaker"], "priority": item["priority"], "text": item["text"],
                                                       "cache_key": res.get("cache_key"), "requested_ts": item["requested_ms"] / 1000, "played_ts": self.loop.clock.now()})
        self._start_next()

    async def close(self) -> None:
        close = getattr(self.tts, "close", None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result


def install(arena) -> VoiceModule:
    return VoiceModule(arena)
