import sys
from pathlib import Path as _Path

sys.path.insert(0, str(_Path(__file__).resolve().parents[1] / "src"))

import asyncio
import unittest
from unittest.mock import patch
from starlette.websockets import WebSocket
from device_transport import install_reconnect_compatibility


class DeviceTransportTests(unittest.TestCase):
    def test_unrelated_transport_faults_are_not_hidden(self):
        async def broken_close(self, **kwargs):
            raise RuntimeError("Unexpected application failure")
        with patch.object(WebSocket, "close", broken_close):
            install_reconnect_compatibility()
            installed = WebSocket.close
            install_reconnect_compatibility()
            self.assertIs(WebSocket.close, installed)
            with self.assertRaisesRegex(RuntimeError, "application failure"):
                asyncio.run(WebSocket.close(None))
