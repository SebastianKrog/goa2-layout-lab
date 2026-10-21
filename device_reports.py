"""Device reports belong to the lab, never the production game server."""
import base64
import binascii
import json
import uuid
from pathlib import Path
from html import escape

from fastapi import HTTPException


def install_device_reports(app, *, checkpoint, write, root, now):
    captures = {}

    @app.post("/__lab/device/capture")
    async def capture(body: dict):
        for identifier, value in list(captures.items()):
            if now() - value["at"] > 3600:
                del captures[identifier]
        if len(captures) >= 40:
            raise HTTPException(429, "Too many pending device reports")
        game = app.state.registry.get(body["game_id"])
        async with game.lock:
            identifier = uuid.uuid4().hex[:12]
            captures[identifier] = {
                "checkpoint": checkpoint(game.session, names=game.hero_names,
                                         replay=game.replay_recorder.records if game.replay_recorder else []),
                "game_id": game.game_id, "at": now(),
                "presentation": body.get("presentation", {}),
                "viewport": body.get("viewport", {}),
                "provenance": body.get("provenance", {}),
            }
        return {"id": identifier}

    @app.post("/__lab/device/report")
    def report(body: dict):
        capture = captures.get(body.get("id"))
        if not capture or capture["game_id"] != body.get("game_id") or now() - capture["at"] > 3600:
            raise HTTPException(409, "Capture expired. Close and capture again.")
        comment = body.get("comment", "")
        if not isinstance(comment, str) or not comment.strip() or len(comment) > 10000:
            raise HTTPException(422, "Add a comment (up to 10,000 characters)")
        screenshot = body.get("screenshot", "")
        try:
            if not screenshot.startswith("data:image/png;base64,"):
                raise ValueError()
            png = base64.b64decode(screenshot.split(",", 1)[1], validate=True)
            if len(png) > 10 * 1024 * 1024 or not png.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError()
        except (ValueError, binascii.Error, AttributeError):
            raise HTTPException(422, "A PNG screenshot under 10 MiB is required")
        identifier = body["id"]
        folder = Path(root) / "reports" / "device" / identifier
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "screenshot.png").write_bytes(png)
        (folder / "report.json").write_text(json.dumps({
            "id": identifier, "comment": comment.strip(), "captured_at": capture["at"],
            "viewport": capture["viewport"], "presentation": capture["presentation"],
            "provenance": capture["provenance"],
        }, indent=2), encoding="utf-8")
        (folder / "index.html").write_text(
            '<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Layout lab device report</title><style>body{font:16px system-ui;max-width:960px;margin:24px auto;padding:0 16px}'
            'pre{white-space:pre-wrap}img{max-width:100%;height:auto}code{overflow-wrap:anywhere}</style>'
            f'<h1>Device report</h1><p>Situation <code>{identifier}</code></p><pre>{escape(comment.strip())}</pre>'
            '<p><a href="report.json">Report data</a> · <a href="situation.json">Situation JSON</a></p>'
            '<img src="screenshot.png" alt="Reported game screen without reporting controls"></html>',
            encoding="utf-8",
        )
        provenance = {**capture["provenance"], "kind": "device-report", "comment": comment.strip(),
                      "viewport": capture["viewport"], "report": f"device/{identifier}"}
        situation = write(capture["checkpoint"], comment.strip()[:160],
                          situation_id=identifier, provenance=provenance,
                          presentations={"0": capture["presentation"], "1": capture["presentation"]},
                          group="device-reports")
        # Keep all integer-valued engine data in Python throughout capture/save.
        (folder / "situation.json").write_text(json.dumps(situation, indent=2), encoding="utf-8")
        return {"id": identifier, "report": f"/reports/device/{identifier}/index.html"}
