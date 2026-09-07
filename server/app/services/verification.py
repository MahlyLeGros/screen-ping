import enum
import logging
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.models import EmailVerification, EmailVerificationPurpose, User

logger = logging.getLogger(__name__)
_code_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_code(code: str) -> str:
    return _code_context.hash(code)


def _verify_code(code: str, code_hash: str) -> bool:
    return _code_context.verify(code, code_hash)


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _invalidate_pending(db: Session, user_id: str, purpose: EmailVerificationPurpose) -> None:
    now = _utcnow()
    pending = (
        db.query(EmailVerification)
        .filter(
            EmailVerification.user_id == user_id,
            EmailVerification.purpose == purpose,
            EmailVerification.used_at.is_(None),
            EmailVerification.expires_at > now,
        )
        .all()
    )
    for row in pending:
        row.used_at = now


def create_verification(
    db: Session,
    *,
    user: User,
    purpose: EmailVerificationPurpose,
    email: str | None = None,
) -> str:
    _invalidate_pending(db, user.id, purpose)
    code = generate_code()
    row = EmailVerification(
        user_id=user.id,
        email=email or user.email,
        purpose=purpose,
        code_hash=_hash_code(code),
        expires_at=_utcnow() + timedelta(minutes=settings.verification_code_expire_minutes),
    )
    db.add(row)
    db.commit()
    return code


def consume_verification(
    db: Session,
    *,
    user: User,
    purpose: EmailVerificationPurpose,
    code: str,
) -> None:
    now = _utcnow()
    rows = (
        db.query(EmailVerification)
        .filter(
            EmailVerification.user_id == user.id,
            EmailVerification.purpose == purpose,
            EmailVerification.used_at.is_(None),
            EmailVerification.expires_at > now,
        )
        .order_by(EmailVerification.created_at.desc())
        .all()
    )
    for row in rows:
        if _verify_code(code, row.code_hash):
            row.used_at = now
            db.commit()
            return
    raise ValueError("Invalid or expired verification code")


def count_recent_verifications(db: Session, user_id: str) -> int:
    since = _utcnow() - timedelta(hours=1)
    return (
        db.query(EmailVerification)
        .filter(EmailVerification.user_id == user_id, EmailVerification.created_at >= since)
        .count()
    )


def maybe_dev_code(code: str, sent: bool) -> str | None:
    if settings.email_dev_expose_codes and not sent:
        return code
    return None


def send_verification_email(to_email: str, subject: str, body: str) -> bool:
    if not settings.smtp_host:
        logger.warning(
            "SMTP not configured — email not sent to %s. Subject: %s\n%s",
            to_email,
            subject,
            body,
        )
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user or "noreply@screenping.xyz"
    msg["To"] = to_email
    msg.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)
    return True


def email_password_reset(user: User, code: str) -> bool:
    body = (
        f"Hi {user.username},\n\n"
        f"Your Screen Ping password reset code is: {code}\n\n"
        f"This code expires in {settings.verification_code_expire_minutes} minutes.\n"
        f"If you did not request this, you can ignore this email.\n"
    )
    return send_verification_email(user.email, "Screen Ping — reset your password", body)


def email_change_password_code(user: User, code: str) -> bool:
    body = (
        f"Hi {user.username},\n\n"
        f"Your verification code to change your password is: {code}\n\n"
        f"This code expires in {settings.verification_code_expire_minutes} minutes.\n"
    )
    return send_verification_email(user.email, "Screen Ping — verify password change", body)


def email_signup_code(user: User, code: str) -> bool:
    body = (
        f"Hi {user.username},\n\n"
        f"Your Screen Ping verification code is: {code}\n\n"
        f"Enter this code to finish creating your account.\n"
        f"This code expires in {settings.verification_code_expire_minutes} minutes.\n"
        f"If you did not create an account, you can ignore this email.\n"
    )
    return send_verification_email(user.email, "Screen Ping — verify your email", body)


def email_change_username_code(user: User, code: str) -> bool:
    body = (
        f"Hi {user.username},\n\n"
        f"Your verification code to change your username is: {code}\n\n"
        f"This code expires in {settings.verification_code_expire_minutes} minutes.\n"
    )
    return send_verification_email(user.email, "Screen Ping — verify username change", body)
