"""Request and response bodies for the API."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field

from .users import User


class Credentials(BaseModel):
    """
    What the login form sends.

    `password` is hashed by `app/passwords.py` before it reaches SQLite on
    signup, and re-derived and compared against the stored hash on login. The
    plaintext exists only for the life of the request.

    The cap is on the input, not the hash: scrypt's cost is per byte of
    password, so an unbounded one would be a way to make the server work
    arbitrarily hard for a single request.
    """

    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class UserResponse(BaseModel):
    """The account the caller is now acting as."""

    id: int
    email: str
    created_at: str

    @classmethod
    def from_user(cls, user: User) -> "UserResponse":
        return cls(id=user.id, email=user.email, created_at=user.created_at)


class SessionResponse(BaseModel):
    """
    What signing up or signing in returns.

    The token is the credential from here on. It is shown exactly once, in this
    response — the database keeps only its hash — so a caller that loses it has
    to sign in again rather than look it up.
    """

    user: UserResponse
    token: str

    @classmethod
    def from_session(cls, user: User, token: str) -> "SessionResponse":
        return cls(user=UserResponse.from_user(user), token=token)


class HealthResponse(BaseModel):
    status: str
    database: str
