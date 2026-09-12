"""FastAPI entrypoint: HTTP API, the single WebSocket endpoint, static mounts, arena lifespan."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .arena import Connection, Intent, SendQueue
from .config import BACKEND_DIR, Config
from .protocol import ProtocolError, ROLES, parse_client
from .store.db import Store
from .wiring import Arena, build_arena
from .voice.commentator import GameCommentator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("hap.main")

config = Config.load()
arena: Arena | None = None
commentator = GameCommentator(config.openai_key)
WEB_DIST = BACKEND_DIR.parent / "web" / "dist"
AUDIO_CACHE = (BACKEND_DIR / config.get("voice.tts.cache_dir", "../assets/audio/cache")).resolve()


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    global arena
    store = None if config.mode == "headless" else Store(BACKEND_DIR / "hap.db")
    arena = build_arena(config, store=store)
    task = asyncio.create_task(arena.loop.run(), name="arena")
    log.info("arena up mode=%s fast_timers=%s public_url=%s", config.mode, config.fast_timers, config.public_url)
    try:
        yield
    finally:
        arena.loop.stop()
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        voice = arena.modules.get("voice.wiring")
        if voice is not None:
            await voice.close()
        if store:
            store.close()


app = FastAPI(title="The House Always Plays", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return {"ok": True, "mode": config.mode, "fast_timers": config.fast_timers,
            "connections": len(arena.loop.conns) if arena else 0, "seq": arena.loop.seq if arena else 0}


@app.get("/api/seats")
async def seats():
    assert arena
    return {"seats": arena.state.seats_public(), "rail_url": arena.state.rail_url()}


class CommentaryRequest(BaseModel):
    event: str = Field(default="golf_shot", max_length=32)
    player: str = Field(default="controller_1", max_length=32)
    power: float = Field(ge=0, le=100)
    shot: int = Field(default=1, ge=1)


@app.post("/api/commentary")
async def commentary(request: CommentaryRequest):
    """Generate a short line, synthesize it through the shared ElevenLabs cache."""
    assert arena
    voice = arena.modules.get("voice.wiring")
    event = request.model_dump()
    text = await commentator.line(event)
    if voice is None:
        return {"text": text, "url": None, "duration_ms": 1200, "cached": False}
    voice_id = voice.voices.get("announcer_a", "")
    audio = await voice.tts.synth(voice_id, text)
    return {
        "text": text,
        "url": audio.get("url"),
        "duration_ms": audio.get("duration_ms", 1200),
        "cached": audio.get("cached", False),
    }


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    assert arena
    role = ws.query_params.get("role", "rail")
    if role not in ROLES:
        await ws.close(code=4400)
        return
    await ws.accept()
    conn = Connection(conn_id=uuid.uuid4().hex[:10], role=role, device_id=ws.query_params.get("device"), out=SendQueue())
    arena.loop.add_connection(conn)
    sender = asyncio.create_task(_pump(ws, conn))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = parse_client(raw)
            except ProtocolError as e:
                await ws.send_text('{"t":"session.error","seq":0,"match":null,"ts":0,"d":{"reason":%s}}' % _js(str(e)))
                continue
            if msg.t == "session.hello":
                conn.device_id = msg.d["device_id"]
                conn.role = msg.d["role"]
            arena.loop.submit(Intent(t=msg.t, d=msg.d, device_id=conn.device_id, conn_id=conn.conn_id, role=conn.role, cseq=msg.cseq))
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("ws error")
    finally:
        arena.loop.remove_connection(conn.conn_id)
        arena.loop.submit(Intent(t="session.disconnect", d={}, device_id=conn.device_id, conn_id=conn.conn_id, role=conn.role))
        sender.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sender


async def _pump(ws: WebSocket, conn: Connection) -> None:
    while True:
        await conn.out.wait()
        for env in conn.out.drain():
            await ws.send_text(env.dumps())


def _js(s: str) -> str:
    import json
    return json.dumps(s)


# Static: audio cache always; built web app when present (production mode, tunnel points at :8000).
AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
app.mount("/audio", StaticFiles(directory=str(AUDIO_CACHE)), name="audio")
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(WEB_DIST / "assets")), name="assets")

    @app.get("/{path:path}")
    async def spa(path: str):
        target = WEB_DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(WEB_DIST / "index.html")
