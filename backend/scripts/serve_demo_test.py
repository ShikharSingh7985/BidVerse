"""Run the application in an isolated PostgreSQL schema for browser tests."""

import json
import socket
import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from threading import Thread
from uuid import uuid4

import uvicorn
from pydantic import AwareDatetime, BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from app import bids
from app.db import Base, engine, get_session
from app.main import app
from app.rfqs import get_server_time
from scripts.seed_demo import seed_demo_accounts


class ClockChange(BaseModel):
    now: AwareDatetime


def serve(schema: str) -> None:
    isolated_engine = engine.execution_options(schema_translate_map={None: schema})
    Base.metadata.create_all(isolated_engine)
    with Session(isolated_engine) as session, session.begin():
        seed_demo_accounts(session)

    def test_session():
        with Session(isolated_engine, expire_on_commit=False) as session:
            yield session

    test_time = datetime.now(timezone.utc).replace(microsecond=0)

    def clock() -> datetime:
        return test_time

    @app.post("/__e2e/clock", include_in_schema=False)
    def set_clock(change: ClockChange) -> None:
        nonlocal test_time
        test_time = change.now.astimezone(timezone.utc)

    @app.middleware("http")
    async def set_date_header(request, call_next):
        response = await call_next(request)
        response.headers["Date"] = format_datetime(clock(), usegmt=True)
        return response

    app.dependency_overrides[get_session] = test_session
    app.dependency_overrides[get_server_time] = clock
    bids.get_server_time = clock

    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", date_header=False))

    def stop_on_stdin_close() -> None:
        sys.stdin.read()
        server.should_exit = True

    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        Thread(target=stop_on_stdin_close, daemon=True).start()
        print(json.dumps({"port": listener.getsockname()[1], "now": clock().isoformat()}), flush=True)
        server.run(sockets=[listener])


def main() -> None:
    schema = f"bidverse_e2e_{uuid4().hex}"
    with engine.begin() as connection:
        connection.execute(CreateSchema(schema))
    try:
        serve(schema)
    finally:
        with engine.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))


if __name__ == "__main__":
    main()
