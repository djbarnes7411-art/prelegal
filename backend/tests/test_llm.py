"""
The model client.

This module exists to turn every way a completion can go wrong into one of two
exceptions, so the rest of the app never has to know what a provider response
looks like. These tests are that promise: nothing here reaches the network.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel

from app.llm import (
    EXTRA_BODY,
    MODEL,
    LlmNotConfigured,
    LlmUnavailable,
    complete_structured,
)


class Answer(BaseModel):
    verdict: str


MESSAGES = [{"role": "user", "content": "Is it Delaware?"}]


def responding(content: object):
    """A stand-in for `litellm.completion` whose message carries `content`."""

    class Message:
        pass

    message = Message()
    message.content = content

    class Choice:
        pass

    choice = Choice()
    choice.message = message

    class Response:
        choices = [choice]

    def completion(**kwargs: Any) -> Response:
        return Response()

    return completion


class TestAsking:
    def test_returns_the_parsed_answer(self) -> None:
        answer = complete_structured(
            MESSAGES, Answer, "key", responding('{"verdict": "yes"}')
        )
        assert answer == Answer(verdict="yes")

    def test_asks_the_model_the_product_settled_on(self) -> None:
        """Pinned because the provider routing is the whole point of this file."""
        seen: dict[str, Any] = {}

        def completion(**kwargs: Any):
            seen.update(kwargs)
            return responding('{"verdict": "yes"}')()

        complete_structured(MESSAGES, Answer, "key", completion)

        assert seen["model"] == MODEL
        assert seen["extra_body"] == EXTRA_BODY
        assert seen["response_format"] is Answer
        assert seen["api_key"] == "key"
        assert seen["messages"] == MESSAGES


class TestFailing:
    def test_does_not_ask_at_all_without_a_key(self) -> None:
        def never_called(**kwargs: Any):
            raise AssertionError("asked the model with no key")

        with pytest.raises(LlmNotConfigured):
            complete_structured(MESSAGES, Answer, None, never_called)

    def test_treats_an_empty_key_as_no_key(self) -> None:
        with pytest.raises(LlmNotConfigured):
            complete_structured(MESSAGES, Answer, "", responding("{}"))

    def test_reports_a_provider_failure(self) -> None:
        def failing(**kwargs: Any):
            raise RuntimeError("connection reset")

        with pytest.raises(LlmUnavailable):
            complete_structured(MESSAGES, Answer, "key", failing)

    def test_reports_an_answer_that_is_not_json(self) -> None:
        with pytest.raises(LlmUnavailable):
            complete_structured(MESSAGES, Answer, "key", responding("I think so?"))

    def test_reports_an_answer_of_the_wrong_shape(self) -> None:
        with pytest.raises(LlmUnavailable):
            complete_structured(
                MESSAGES, Answer, "key", responding('{"something": "else"}')
            )

    def test_reports_an_answer_with_no_content(self) -> None:
        with pytest.raises(LlmUnavailable):
            complete_structured(MESSAGES, Answer, "key", responding(None))

    def test_reports_a_response_with_no_choices(self) -> None:
        class Empty:
            choices: list[object] = []

        with pytest.raises(LlmUnavailable):
            complete_structured(MESSAGES, Answer, "key", lambda **kwargs: Empty())

    def test_reports_a_response_of_an_unrecognised_shape(self) -> None:
        with pytest.raises(LlmUnavailable):
            complete_structured(MESSAGES, Answer, "key", lambda **kwargs: object())
