"""One real persona call (needs OPENAI_KEY in backend/.env): prints latency and the chosen option."""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.agents.persona import OpenAIPersona  # noqa: E402
from app.agents.policy import DecisionRequest, Option, TierConfig  # noqa: E402
from app.config import Config  # noqa: E402


async def main(tier_id: str = "rookie"):
    cfg = Config.load()
    if not cfg.openai_key:
        raise SystemExit("OPENAI_KEY not set in backend/.env")
    tier = TierConfig.from_dict("bowling", cfg.tier("bowling", tier_id))
    p = OpenAIPersona(cfg.openai_key, str(cfg.get("tiers.persona.model", "gpt-5-mini")), float(cfg.get("tiers.persona.timeout_s", 1.5)))
    opts = [Option("pocket", "Play the pocket", ev=0.55), Option("straight", "Roll it straight", ev=0.45), Option("hook_hard", "Big hook", ev=0.4)]
    req = DecisionRequest("house:bowling:" + tier_id, opts, opts[0], {"frame": 3, "human_score": 42, "house_score": 30, "last_human": "strike"}, 3, "m_smoke")
    t0 = time.perf_counter()
    choice = await p.choose(req, tier, {"results": ["lost"], "moment": "gutter-balled twice", "last_line": None})
    print(f"{(time.perf_counter() - t0) * 1000:.0f} ms ->", choice)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "rookie"))
