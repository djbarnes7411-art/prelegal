"""
Sign up and sign in.

**These endpoints do not authenticate anyone.** PL-4 asks for a login screen that
brings the user into the platform, not for authentication: the submitted password
is accepted by the request model and then discarded, and knowing an address is
enough to sign in as it. What is real is the account record — the request reaches
FastAPI, which reads and writes SQLite, which is the path the rest of V1 builds on.

The endpoint shapes are the ones real authentication needs, so adding password
hashing and sessions later changes these two function bodies and nothing else.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from ..dependencies import get_connection
from ..models import Credentials, UserResponse
from ..users import EmailAlreadyRegistered, create_user, get_user_by_email

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(
    credentials: Credentials,
    connection: sqlite3.Connection = Depends(get_connection),
) -> UserResponse:
    """Creates an account for an address that does not have one."""
    try:
        user = create_user(connection, credentials.email)
    except EmailAlreadyRegistered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with that email already exists. Sign in instead.",
        ) from None

    return UserResponse.from_user(user)


@router.post("/login", response_model=UserResponse)
def login(
    credentials: Credentials,
    connection: sqlite3.Connection = Depends(get_connection),
) -> UserResponse:
    """
    Signs in as an existing account.

    The password is ignored. The lookup can still fail, because an address with
    no account is a genuine mistake worth reporting rather than quietly creating.
    """
    user = get_user_by_email(connection, credentials.email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for that email. Create one to continue.",
        )

    return UserResponse.from_user(user)
