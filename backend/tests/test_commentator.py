import pytest

from app.voice.commentator import GameCommentator


@pytest.mark.asyncio
async def test_offline_commentator_uses_power_and_player():
    commentator = GameCommentator(None)
    line = await commentator.line({"event": "golf_shot", "player": "controller_2", "power": 94})
    assert "Player Two" in line
    assert "94" in line
    assert len(line) <= 90
