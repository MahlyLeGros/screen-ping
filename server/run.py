#!/usr/bin/env python
"""ASGI entry point with Socket.IO mounted."""
from app.main import socket_app

app = socket_app
