"""
Sign up, sign in, sign out.

**These endpoints authenticate, as of PL-7.** Signup hashes the password with
`app/passwords.py` before it reaches SQLite; login re-derives the hash from what
was submitted and compares the two in constant time. Both then open a session and
return its token, which the caller sends back as `Authorization: Bearer <token>`
on everything that needs an account behind it.

A wrong password is a 401 and an unregistered address is a 404 — kept apart on
purpose. It does mean a caller can learn whether an address has an account here,
which is a real cost; it is accepted because the alternative is telling someone
who mistyped their address to "check the email and password" when creating an
account is what they actually need, and because collapsing the two would not
close enumeration anyway while signup still answers 409 for an address that
exists. Closing it properly is one piece of work with rate limiting, which is
still unbuilt.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException, status

from ..dependencies import get_connection, get_current_user
from ..models import Credentials, SessionResponse, UserResponse
from ..sessions import bearer_token, create_session, delete_session
from ..users import (
    EmailAlreadyRegistered,
    InvalidPassword,
    UnknownEmail,
    User,
    authenticate_user,
    create_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/signup", response_model=SessionResponse, status_code=status.HTTP_201_CREATED
)
def signup(
    credentials: Credentials,
    connection: sqlite3.Connection = Depends(get_connection),
) -> SessionResponse:
    """Creates an account for an address that does not have one, and signs it in."""
    try:
        user = create_user(connection, credentials.email, credentials.password)
    except EmailAlreadyRegistered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists. Sign in instead.",
        ) from None

    _, token = create_session(connection, user.id)
    return SessionResponse.from_session(user, token)


@router.post("/login", response_model=SessionResponse)
def login(
    credentials: Credentials,
    connection: sqlite3.Connection = Depends(get_connection),
) -> SessionResponse:
    """
    Signs in as an existing account.

    Always opens a new session and never touches one this account already holds:
    signing in on a second device must not sign the first one out, because
    nothing here can tell the first device that happened.
    """
    try:
        user = authenticate_user(
            connection, credentials.email, credentials.password
        )
    except UnknownEmail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for that email. Create one to continue.",
        ) from None
    except InvalidPassword:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="That password does not match this account. Try again.",
        ) from None

    _, token = create_session(connection, user.id)
    return SessionResponse.from_session(user, token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    authorization: str | None = Header(default=None),
    connection: sqlite3.Connection = Depends(get_connection),
) -> None:
    """
    Ends the session the caller's own token names.

    Deliberately not behind `get_current_user`: signing out with a token that
    has already expired or been revoked is not an error, it is the thing the
    caller was trying to achieve.
    """
    token = bearer_token(authorization)
    if token:
        delete_session(connection, token)


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(get_current_user)) -> UserResponse:
    """The account the caller's token is signed in as."""
    return UserResponse.from_user(user)
