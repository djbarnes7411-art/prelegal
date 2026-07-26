"""Request and response bodies for the API."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field

from .users import User


class Credentials(BaseModel):
    """
    What the login form sends.

    `password` is required so the form and the API already have the shape real
    authentication needs, but the value is never hashed, stored, or compared —
    see `routers/auth.py`.
    """

    email: EmailStr
    password: str = Field(min_length=1)


class UserResponse(BaseModel):
    """The account the caller is now acting as."""

    id: int
    email: str
    created_at: str

    @classmethod
    def from_user(cls, user: User) -> "UserResponse":
        return cls(id=user.id, email=user.email, created_at=user.created_at)


class HealthResponse(BaseModel):
    status: str
    database: str
