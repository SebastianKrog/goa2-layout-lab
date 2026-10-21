"""Compatibility for rapid device reconnects in the isolated lab process."""
from functools import wraps


def install_reconnect_compatibility():
    from starlette.websockets import WebSocket, WebSocketDisconnect

    original = WebSocket.close
    if getattr(original, "_goa2_lab_reconnect", False):
        return

    @wraps(original)
    async def close(self, code=1000, reason=None):
        try:
            return await original(self, code=code, reason=reason)
        except WebSocketDisconnect:
            return None
        except RuntimeError as error:
            # Superseding a transport that already closed must not prevent the
            # new player connection from receiving its initial state. Limit
            # the shim to known closed-transport messages; surface other faults.
            if not any(message in str(error) for message in (
                "Unexpected ASGI message 'websocket.close'",
                'Cannot call "send" once a close message has been sent.',
            )):
                raise
            return None

    close._goa2_lab_reconnect = True
    WebSocket.close = close
