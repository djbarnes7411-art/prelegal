from __future__ import annotations

import sqlite3

import pytest

from app.drafts import (
    DraftNotFound,
    create_draft,
    delete_draft,
    get_draft,
    list_drafts,
    update_draft,
)
from app.users import create_user

FIELDS = {"pilotPeriod": "60 days", "provider": {"companyName": "Acme"}}
MESSAGES = [{"role": "user", "content": "I need a pilot agreement"}]


@pytest.fixture
def ada(connection: sqlite3.Connection) -> int:
    return create_user(connection, "ada@example.com", "correct-horse").id


@pytest.fixture
def grace(connection: sqlite3.Connection) -> int:
    return create_user(connection, "grace@example.com", "correct-horse").id


class TestStartingADraft:
    def test_returns_what_it_stored(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        assert draft.user_id == ada
        assert draft.document_slug == "pilot-agreement"
        assert draft.fields == FIELDS
        assert draft.messages == MESSAGES
        assert draft.created_at and draft.updated_at

    def test_the_json_survives_a_round_trip(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        """Nested values matter: a party is an object, not a string."""
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        assert get_draft(connection, ada, draft.id).fields == FIELDS

    def test_it_survives_the_connection_that_made_it(
        self, connection: sqlite3.Connection, ada: int, database_path
    ) -> None:
        from contextlib import closing

        from app.db import connect

        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        with closing(connect(database_path)) as other:
            assert get_draft(other, ada, draft.id) == draft


class TestListingDrafts:
    def test_is_empty_for_a_new_account(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        assert list_drafts(connection, ada) == []

    def test_shows_the_most_recently_worked_on_first(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        first = create_draft(connection, ada, "pilot-agreement", {}, [])
        second = create_draft(connection, ada, "mutual-nda", {}, [])
        # Same second, most likely, so `updated_at` alone cannot order these —
        # the id breaks the tie, which is what this asserts.
        listed = [draft.id for draft in list_drafts(connection, ada)]

        assert listed == [second.id, first.id]

    def test_a_touched_draft_moves_to_the_front(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        older = create_draft(connection, ada, "pilot-agreement", {}, [])
        create_draft(connection, ada, "mutual-nda", {}, [])

        connection.execute(
            "UPDATE drafts SET updated_at = ? WHERE id = ?",
            ("2099-01-01T00:00:00Z", older.id),
        )
        connection.commit()

        assert list_drafts(connection, ada)[0].id == older.id

    def test_shows_only_this_account_s_drafts(
        self, connection: sqlite3.Connection, ada: int, grace: int
    ) -> None:
        create_draft(connection, ada, "pilot-agreement", {}, [])
        create_draft(connection, grace, "mutual-nda", {}, [])

        assert [draft.document_slug for draft in list_drafts(connection, grace)] == [
            "mutual-nda"
        ]


class TestSavingADraft:
    def test_replaces_the_values_and_the_transcript(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        saved = update_draft(
            connection, ada, draft.id, {"pilotPeriod": "90 days"}, []
        )

        assert saved.fields == {"pilotPeriod": "90 days"}
        assert saved.messages == []

    def test_leaves_the_document_and_the_start_time_alone(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        saved = update_draft(connection, ada, draft.id, {}, [])

        assert saved.document_slug == draft.document_slug
        assert saved.created_at == draft.created_at

    def test_moves_the_updated_time_forward(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)
        connection.execute(
            "UPDATE drafts SET updated_at = ? WHERE id = ?",
            ("2020-01-01T00:00:00Z", draft.id),
        )
        connection.commit()

        saved = update_draft(connection, ada, draft.id, FIELDS, MESSAGES)

        assert saved.updated_at > "2020-01-01T00:00:00Z"


class TestSomeoneElseSDraft:
    """
    Ownership is part of every query, not a check after the fetch.

    Each of these passes another account's id for a row that really exists, and
    each must be indistinguishable from asking for a row that never did.
    """

    def test_cannot_be_read(
        self, connection: sqlite3.Connection, ada: int, grace: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        with pytest.raises(DraftNotFound):
            get_draft(connection, grace, draft.id)

    def test_cannot_be_written(
        self, connection: sqlite3.Connection, ada: int, grace: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        with pytest.raises(DraftNotFound):
            update_draft(connection, grace, draft.id, {}, [])

        assert get_draft(connection, ada, draft.id).fields == FIELDS

    def test_cannot_be_deleted(
        self, connection: sqlite3.Connection, ada: int, grace: int
    ) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        with pytest.raises(DraftNotFound):
            delete_draft(connection, grace, draft.id)

        assert get_draft(connection, ada, draft.id) is not None


class TestADraftThatIsNotThere:
    def test_reading_it_raises(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        with pytest.raises(DraftNotFound):
            get_draft(connection, ada, 4321)

    def test_writing_it_raises(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        with pytest.raises(DraftNotFound):
            update_draft(connection, ada, 4321, {}, [])

    def test_deleting_it_raises(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        with pytest.raises(DraftNotFound):
            delete_draft(connection, ada, 4321)


class TestDeletingADraft:
    def test_it_is_gone(self, connection: sqlite3.Connection, ada: int) -> None:
        draft = create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        delete_draft(connection, ada, draft.id)

        with pytest.raises(DraftNotFound):
            get_draft(connection, ada, draft.id)

    def test_deleting_the_account_takes_its_drafts_with_it(
        self, connection: sqlite3.Connection, ada: int
    ) -> None:
        """Exercises `ON DELETE CASCADE`, and so the foreign-key pragma."""
        create_draft(connection, ada, "pilot-agreement", FIELDS, MESSAGES)

        connection.execute("DELETE FROM users WHERE id = ?", (ada,))
        connection.commit()

        assert connection.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 0
