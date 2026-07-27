from __future__ import annotations

import pytest

from app.passwords import hash_password, verify_password


def test_a_password_verifies_against_its_own_hash() -> None:
    assert verify_password("correct-horse", hash_password("correct-horse"))


def test_a_different_password_does_not() -> None:
    assert not verify_password("Correct-Horse", hash_password("correct-horse"))


def test_an_empty_password_does_not_match_a_real_one() -> None:
    assert not verify_password("", hash_password("correct-horse"))


def test_the_hash_does_not_contain_the_password() -> None:
    assert "correct-horse" not in hash_password("correct-horse")


def test_two_hashes_of_one_password_differ() -> None:
    """Salted — otherwise a leaked table shows who shares a password with whom."""
    assert hash_password("correct-horse") != hash_password("correct-horse")


def test_the_hash_carries_its_parameters() -> None:
    """
    So raising the cost later leaves existing hashes verifiable.

    Verification reads N, r and p from the stored string rather than from the
    module's current constants, which is what keeps an old hash working.
    """
    scheme, n, r, p, salt, digest = hash_password("correct-horse").split("$")

    assert scheme == "scrypt"
    assert int(n) > 1 and int(r) > 0 and int(p) > 0
    assert bytes.fromhex(salt) and bytes.fromhex(digest)


def test_a_hash_made_with_other_parameters_still_verifies() -> None:
    """The stored parameters win, not the module's."""
    weaker = hash_password("correct-horse").split("$")
    # Rebuild at a lower cost the way an older version of this module would have.
    import hashlib

    salt = bytes.fromhex(weaker[4])
    derived = hashlib.scrypt(
        b"correct-horse", salt=salt, n=2**10, r=8, p=1, dklen=32
    )
    stored = f"scrypt$1024$8$1${salt.hex()}${derived.hex()}"

    assert verify_password("correct-horse", stored)


@pytest.mark.parametrize(
    "stored",
    [
        "",
        "correct-horse",
        "scrypt$16384$8$1$deadbeef",
        "scrypt$16384$8$1$nothex$nothex",
        "bcrypt$16384$8$1$dead$beef",
        "scrypt$notanumber$8$1$dead$beef",
    ],
    ids=[
        "empty",
        "plaintext",
        "too few parts",
        "salt is not hex",
        "a scheme we do not use",
        "a parameter that is not a number",
    ],
)
def test_a_hash_this_module_cannot_read_fails_closed(stored: str) -> None:
    """A corrupt hash must never let someone in, and must never raise either."""
    assert verify_password("correct-horse", stored) is False
