import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import engine, get_session
from app.main import app


@pytest.fixture
def connection():
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            transaction.rollback()


@pytest.fixture
def client(connection, monkeypatch):
    def test_session():
        with Session(
            bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
        ) as session:
            yield session

    monkeypatch.setitem(app.dependency_overrides, get_session, test_session)
    with TestClient(app) as client:
        yield client
