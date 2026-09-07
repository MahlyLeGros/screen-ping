from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import (
    bump_token_version,
    decode_token,
    get_current_user,
    hash_password,
    issue_tokens,
    verify_password,
)
from app.auth_cookies import (
    clear_refresh_cookie,
    is_desktop_client,
    read_refresh_token,
    resolve_persist,
    set_refresh_cookie,
)
from app.config import settings
from app.database import get_db
from app.models import EmailVerificationPurpose, User
from app.models import DeviceSession, EmailVerification, Friendship, MediaMessage, utcnow
from app.realtime import check_login_rate_limit, presence_manager, check_reset_password_rate_limit
from app.schemas import (
    AuthProvidersResponse,
    AcceptLegalRequest,
    ChangePasswordRequest,
    ChangeUsernameRequest,
    DeleteAccountRequest,
    DesktopLinkPairingRequest,
    DesktopLinkPollRequest,
    DesktopLinkPollResponse,
    DesktopLinkStartResponse,
    ForgotPasswordRequest,
    GoogleAuthRequest,
    GoogleAuthResponse,
    LoginRequest,
    OkResponse,
    RefreshRequest,
    RegisterRequest,
    RequestVerificationRequest,
    ResendSignupCodeRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
    VerificationRequestResponse,
    VerifyEmailRequest,
)
from app.services.desktop_link import approve_desktop_link, deny_desktop_link, poll_desktop_link, start_desktop_link
from app.services.google_auth import complete_google_auth, verify_google_credential
from app.services.verification import (
    consume_verification,
    count_recent_verifications,
    create_verification,
    email_change_password_code,
    email_change_username_code,
    email_password_reset,
    email_signup_code,
    maybe_dev_code,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/providers", response_model=AuthProvidersResponse)
def auth_providers():
    client_id = (settings.google_client_id or "").strip()
    return AuthProvidersResponse(google_client_id=client_id or None)


@router.post("/google", response_model=GoogleAuthResponse, response_model_exclude_none=True)
def google_auth(body: GoogleAuthRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    info = verify_google_credential(body.credential)
    result = complete_google_auth(
        db,
        email=info["email"],
        sub=info["sub"],
        username=body.username,
        accept_terms=body.accept_terms,
    )
    if result.needs_username or is_desktop_client(request):
        return result
    if result.access_token and result.refresh_token:
        persist = resolve_persist(request, body.remember_me)
        set_refresh_cookie(response, result.refresh_token, persist=persist)
        result.refresh_token = None
    return result


@router.post("/desktop-link/start", response_model=DesktopLinkStartResponse)
def desktop_link_start(request: Request, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else ""
    if not check_login_rate_limit(client_ip, "desktop-link"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many desktop login attempts. Try again later.",
        )
    pairing_id, poll_secret, expires_in = start_desktop_link(db)
    return DesktopLinkStartResponse(pairing_id=pairing_id, poll_secret=poll_secret, expires_in=expires_in)


@router.post("/desktop-link/approve", response_model=OkResponse)
def desktop_link_approve(
    body: DesktopLinkPairingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    approve_desktop_link(db, body.pairing_id, user)
    return OkResponse(message="Desktop app can now sign in.")


@router.post("/desktop-link/deny", response_model=OkResponse)
def desktop_link_deny(
    body: DesktopLinkPairingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    deny_desktop_link(db, body.pairing_id, user)
    return OkResponse(message="Desktop login cancelled.")


@router.post("/desktop-link/poll", response_model=DesktopLinkPollResponse)
def desktop_link_poll(body: DesktopLinkPollRequest, db: Session = Depends(get_db)):
    result = poll_desktop_link(db, body.pairing_id, body.poll_secret)
    return DesktopLinkPollResponse(**result)


FORGOT_PASSWORD_MESSAGE = (
    "If an account exists for that email, we sent a 6-digit reset code. "
    "Check your inbox and spam folder."
)
SIGNUP_CODE_MESSAGE = (
    "We sent a 6-digit verification code to your email. "
    "Enter it to finish creating your account."
)
RESEND_SIGNUP_MESSAGE = (
    "If that email needs verification, we sent a 6-digit code. "
    "Check your inbox and spam folder."
)


def _user_response(user: User) -> UserResponse:
    current_terms_version = settings.terms_version
    needs_terms_acceptance = (
        not user.terms_accepted_at or user.terms_accepted_version != current_terms_version
    )
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar_url=user.avatar_url,
        created_at=user.created_at,
        terms_accepted_at=user.terms_accepted_at,
        terms_accepted_version=user.terms_accepted_version,
        current_terms_version=current_terms_version,
        needs_terms_acceptance=needs_terms_acceptance,
        is_desktop_online=presence_manager.is_online(user.id),
        desktop_version=presence_manager.get_desktop_version(user.id),
    )


def _check_rate_limit(db: Session, user: User) -> None:
    if count_recent_verifications(db, user.id) >= settings.verification_rate_limit_per_hour:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification requests. Try again later.",
        )


def _email_verified(user: User) -> bool:
    return getattr(user, "email_verified_at", None) is not None


def _token_response(
    request: Request,
    response: Response,
    user: User,
    *,
    remember_me: bool | None = None,
) -> TokenResponse:
    access_token, refresh_token = issue_tokens(user)
    if is_desktop_client(request):
        return TokenResponse(access_token=access_token, refresh_token=refresh_token)
    persist = resolve_persist(request, remember_me)
    set_refresh_cookie(response, refresh_token, persist=persist)
    return TokenResponse(access_token=access_token)


def _send_signup_code(db: Session, user: User) -> str | None:
    _check_rate_limit(db, user)
    code = create_verification(db, user=user, purpose=EmailVerificationPurpose.signup)
    sent = email_signup_code(user, code)
    return maybe_dev_code(code, sent)


def _pending_signup_response(user: User, dev_code: str | None) -> VerificationRequestResponse:
    return VerificationRequestResponse(
        message=SIGNUP_CODE_MESSAGE,
        dev_code=dev_code,
        email=user.email,
        username=user.username,
        needs_verification=True,
    )


@router.post("/register", response_model=VerificationRequestResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if not body.accept_terms:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You must accept the Terms of Use.")

    existing = (
        db.query(User)
        .filter((User.username == body.username) | (User.email == body.email))
        .all()
    )
    same_account = next(
        (user for user in existing if user.username == body.username and user.email == body.email),
        None,
    )
    if same_account:
        if _email_verified(same_account):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")
        if not verify_password(body.password, same_account.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")
        return _pending_signup_response(same_account, _send_signup_code(db, same_account))
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")

    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        terms_accepted_at=utcnow(),
        terms_accepted_version=settings.terms_version,
        email_verified_at=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _pending_signup_response(user, _send_signup_code(db, user))


@router.post("/verify-email", response_model=TokenResponse, response_model_exclude_none=True)
def verify_email(body: VerifyEmailRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification code")
    if _email_verified(user):
        return _token_response(request, response, user, remember_me=body.remember_me)
    try:
        consume_verification(db, user=user, purpose=EmailVerificationPurpose.signup, code=body.code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    user.email_verified_at = utcnow()
    db.commit()
    return _token_response(request, response, user, remember_me=body.remember_me)


@router.post("/resend-signup-code", response_model=VerificationRequestResponse)
def resend_signup_code(body: ResendSignupCodeRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    dev_code = None
    if user and not _email_verified(user):
        try:
            dev_code = _send_signup_code(db, user)
        except HTTPException:
            raise
    return VerificationRequestResponse(message=RESEND_SIGNUP_MESSAGE, dev_code=dev_code, email=body.email)


def find_user_by_login(db: Session, identifier: str) -> User | None:
    ident = identifier.strip()
    if not ident:
        return None
    if "@" in ident:
        return db.query(User).filter(func.lower(User.email) == ident.lower()).first()
    return db.query(User).filter(User.username == ident).first()


@router.post("/login", response_model=TokenResponse, response_model_exclude_none=True)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = request.client.host if request.client else ""
    identifier = body.username.strip()
    if not check_login_rate_limit(client_ip, identifier):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
        )
    user = find_user_by_login(db, identifier)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not _email_verified(user):
        try:
            _send_signup_code(db, user)
        except HTTPException:
            pass
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Email not verified. Enter the 6-digit code we sent you.",
                "code": "email_not_verified",
                "email": user.email,
            },
        )
    return _token_response(request, response, user, remember_me=body.remember_me)


@router.post("/refresh", response_model=TokenResponse, response_model_exclude_none=True)
def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: Session = Depends(get_db),
):
    refresh_token = read_refresh_token(request, body.refresh_token if body else None)
    payload = decode_token(refresh_token, expected_type="refresh")
    user = db.get(User, payload["sub"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if payload.get("tv", 0) != int(getattr(user, "token_version", 0) or 0):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
    return _token_response(request, response, user)


@router.post("/logout", response_model=OkResponse)
def logout(request: Request, response: Response):
    if not is_desktop_client(request):
        clear_refresh_cookie(response)
    return OkResponse(message="Logged out.")


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)


@router.post("/forgot-password", response_model=VerificationRequestResponse)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email).first()
    dev_code = None
    if user:
        _check_rate_limit(db, user)
        code = create_verification(db, user=user, purpose=EmailVerificationPurpose.password_reset)
        sent = email_password_reset(user, code)
        dev_code = maybe_dev_code(code, sent)
    return VerificationRequestResponse(message=FORGOT_PASSWORD_MESSAGE, dev_code=dev_code)


@router.post("/reset-password", response_model=TokenResponse, response_model_exclude_none=True)
def reset_password(body: ResetPasswordRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if not check_reset_password_rate_limit(body.email):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many reset attempts. Try again later.",
        )
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification code")
    try:
        consume_verification(db, user=user, purpose=EmailVerificationPurpose.password_reset, code=body.code)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    user.password_hash = hash_password(body.new_password)
    bump_token_version(user)
    db.commit()
    return _token_response(request, response, user, remember_me=body.remember_me)


@router.post("/me/request-verification", response_model=VerificationRequestResponse)
def request_verification(
    body: RequestVerificationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _check_rate_limit(db, current_user)
    if body.purpose == "change_password":
        purpose = EmailVerificationPurpose.change_password
        code = create_verification(db, user=current_user, purpose=purpose)
        sent = email_change_password_code(current_user, code)
        message = "We sent a verification code to your email."
    else:
        purpose = EmailVerificationPurpose.change_username
        code = create_verification(db, user=current_user, purpose=purpose)
        sent = email_change_username_code(current_user, code)
        message = "We sent a verification code to confirm your username change."
    return VerificationRequestResponse(message=message, dev_code=maybe_dev_code(code, sent))


@router.patch("/me/username", response_model=UserResponse)
def change_username(
    body: ChangeUsernameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.username != current_user.username:
        taken = db.query(User).filter(User.username == body.username, User.id != current_user.id).first()
        if taken:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")
    try:
        consume_verification(
            db, user=current_user, purpose=EmailVerificationPurpose.change_username, code=body.verification_code
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    current_user.username = body.username
    db.commit()
    db.refresh(current_user)
    return _user_response(current_user)


@router.patch("/me/password", response_model=OkResponse)
def change_password(
    body: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different")
    try:
        consume_verification(
            db, user=current_user, purpose=EmailVerificationPurpose.change_password, code=body.verification_code
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    current_user.password_hash = hash_password(body.new_password)
    bump_token_version(current_user)
    db.commit()
    return OkResponse(message="Password updated successfully.")


@router.patch("/me/accept-legal", response_model=UserResponse)
def accept_legal(
    body: AcceptLegalRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.accept_terms:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Terms must be accepted.")
    current_user.terms_accepted_at = utcnow()
    current_user.terms_accepted_version = settings.terms_version
    db.commit()
    db.refresh(current_user)
    return _user_response(current_user)


@router.delete("/me", response_model=OkResponse)
def delete_account(
    body: DeleteAccountRequest,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    db.query(MediaMessage).filter(
        (MediaMessage.sender_id == current_user.id) | (MediaMessage.receiver_id == current_user.id)
    ).delete(synchronize_session=False)
    db.query(Friendship).filter(
        (Friendship.requester_id == current_user.id)
        | (Friendship.addressee_id == current_user.id)
        | (Friendship.blocked_by_id == current_user.id)
    ).delete(synchronize_session=False)
    db.query(EmailVerification).filter(EmailVerification.user_id == current_user.id).delete(synchronize_session=False)
    db.query(DeviceSession).filter(DeviceSession.user_id == current_user.id).delete(synchronize_session=False)
    db.delete(current_user)
    db.commit()
    if not is_desktop_client(request):
        clear_refresh_cookie(response)
    return OkResponse(message="Account deleted.")
