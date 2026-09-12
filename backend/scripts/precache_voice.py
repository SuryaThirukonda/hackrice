"""Generate the offline audio cache: every persona taunt plus templated priority-3 lines (needs ELEVENLABS_API_KEY)."""
import asyncio
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import BACKEND_DIR, Config  # noqa: E402
from app.voice.triggers import load_triggers  # noqa: E402
from app.voice.tts import ElevenLabsTTS  # noqa: E402

NAMES = ["Judge", "Ace", "Lucky", "Champ", "Rookie"]


async def main():
    cfg = Config.load()
    if not cfg.elevenlabs_key:
        raise SystemExit("ELEVENLABS_API_KEY not set in backend/.env")
    vc = cfg.section("voice")
    cache = (BACKEND_DIR / vc["tts"]["cache_dir"]).resolve()
    tts = ElevenLabsTTS(cfg.elevenlabs_key, cache, vc["tts"]["model_id"], vc["tts"]["output_format"], 15.0)
    jobs = []
    for sport in ("bowling", "baseball", "boxing"):
        for t in cfg.tiers(sport):
            for line in t.get("taunts", []):
                jobs.append((t["voice_id"], line))
    trig = load_triggers(vc)
    rng = random.Random(1)
    for name, tr in trig.items():
        if tr.priority >= 2 and not tr.persona_line:
            for tpl in tr.templates:
                for n in NAMES[:3]:
                    jobs.append((vc["voices"][tr.speaker], tpl.format(player=n, loser=n, winner=n, opponent="the House", amount="120", outcome="Spare")))
    print(f"{len(jobs)} clips")
    done = 0
    for voice, text in jobs:
        r = await tts.synth(voice, text)
        done += 1
        print(f"[{done}/{len(jobs)}] {'cached' if r.get('cached') else ('ok' if r.get('url') else 'FAIL ' + str(r.get('error')))}: {text[:50]}")
    await tts.close()


if __name__ == "__main__":
    asyncio.run(main())
