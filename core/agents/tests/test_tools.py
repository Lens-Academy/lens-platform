from core.agents.tools import build_transfer_tool, build_all_transfer_tools


def test_build_transfer_tool_schema():
    tool = build_transfer_tool("tutor")
    assert tool["type"] == "function"
    assert tool["function"]["name"] == "transfer_to_tutor"
    params = tool["function"]["parameters"]
    assert "reason" in params["properties"]
    assert "reason" in params["required"]


def test_build_transfer_tool_description_mentions_target():
    tool = build_transfer_tool("coach")
    assert "coach" in tool["function"]["description"].lower()


def test_build_all_transfer_tools(monkeypatch):
    from core.agents.tools import transfer as transfer_module
    fake_registry = {"coach": None, "tutor": None}
    monkeypatch.setattr(transfer_module, "AGENT_REGISTRY", fake_registry)
    all_tools = build_all_transfer_tools()
    assert len(all_tools) == 2
    names = {t["function"]["name"] for t in all_tools}
    assert names == {"transfer_to_coach", "transfer_to_tutor"}
