"""
Hashing and checking passwords.

Standard library only. `hashlib.scrypt` is a memory-hard KDF that ships with
Python, so real password storage costs this project no new dependency — and no
wheel to compile in the slim runtime image — which is why it is here rather than
passlib, bcrypt or argon2.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

# RFC 7914's "interactive login" parameters: 128 * r * N is about 16 MiB, which
# sits under OpenSSL's 32 MiB default `maxmem` so no caller has to raise it, and
# is quick enough for a request thread. This runs on every signup and every
# login attempt, not once against a file at rest, so the much larger parameters
# meant for file encryption would buy little and cost every sign-in.
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
KEY_LENGTH = 32

SCHEME = "scrypt"


def hash_password(password: str) -> str:
    """
    A salted hash, as `scrypt$N$r$p$salt$hash` with salt and hash in hex.

    The parameters travel with the hash rather than being read from the
    constants above at verification time, so raising them later leaves every
    existing hash verifiable instead of locking its owner out.
    """
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=KEY_LENGTH,
    )
    return f"{SCHEME}${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """
    Whether `password` is the one `stored` was made from.

    Compared with `hmac.compare_digest`: a comparison that returned on the first
    differing byte would leak the expected hash one timing measurement at a time.

    A stored value this function cannot make sense of — a scheme it does not
    know, a truncated string, a salt that is not hex — is treated as "does not
    match" rather than raising. A corrupt hash must fail closed; there is no
    reading of it that should let someone in.
    """
    try:
        scheme, n, r, p, salt_hex, hash_hex = stored.split("$")
        if scheme != SCHEME:
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False

    return hmac.compare_digest(derived, expected)
