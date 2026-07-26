"""
The one place this product talks to a language model.

Everything model-specific lives here — the provider routing, the API key, and
the two failure modes worth telling a user apart. Callers hand over messages and
a Pydantic class describing the answer they want, and get an instance of that
class back or an exception; they never see LiteLLM, OpenRouter, or Cerebras.

Kept separate from `documents/chat.py` so the domain module can be unit-tested
by substituting one function, with no network and no key.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

MODEL = "openrouter/openai/gpt-oss-120b"

# Pins inference to Cerebras rather than letting OpenRouter pick a provider.
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}

Answer = TypeVar("Answer", bound=BaseModel)


class LlmNotConfigured(Exception):
    """No API key, so the request was never attempted."""


class LlmUnavailable(Exception):
    """The model was asked and did not give a usable answer."""


class CompletionFn(Protocol):
    """The shape of `litellm.completion` this module depends on."""

    def __call__(self, **kwargs: Any) -> Any: ...


def _completion() -> CompletionFn:
    """
    Imports LiteLLM at call time.

    It is a heavy import, and a request that has no API key never needs it —
    which is also what keeps the test suite fast and offline.
    """
    from litellm import completion

    return completion


def complete_structured(
    messages: list[dict[str, str]],
    answer_model: type[Answer],
    api_key: str | None,
    completion_fn: CompletionFn | None = None,
) -> Answer:
    """
    Asks the model for one answer shaped like `answer_model`.

    Raises `LlmNotConfigured` when there is no key to use, and `LlmUnavailable`
    when the provider fails or returns something that will not parse. Both are
    exceptions rather than a partial answer: a caller cannot do anything useful
    with half a turn.
    """
    if not api_key:
        raise LlmNotConfigured

    completion = completion_fn or _completion()

    try:
        response = completion(
            model=MODEL,
            messages=messages,
            response_format=answer_model,
            reasoning_effort="low",
            extra_body=EXTRA_BODY,
            api_key=api_key,
        )
    except Exception as error:  # noqa: BLE001 — every provider failure looks the same here
        logger.warning("Completion request failed: %s", error)
        raise LlmUnavailable from error

    try:
        content = response.choices[0].message.content
        return answer_model.model_validate_json(content)
    except (ValidationError, AttributeError, IndexError, TypeError) as error:
        logger.warning("Completion response could not be read: %s", error)
        raise LlmUnavailable from error
