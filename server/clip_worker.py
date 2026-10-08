"""One persistent import worker; anonymous extraction runs in bounded subprocesses."""
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

from app.config import settings
from app.database import SessionLocal
from app.models import MediaImport, utcnow
from app.services.media_access import delete_upload_file, media_path_still_in_use, resolve_upload_file
from app.services.video_import import FINAL_BYTES
from import_worker import process_job as process_legacy, terminate_tree


def enabled(platform):
    return platform == "local" or bool(getattr(settings, platform + "_import_enabled", False))


def clean_job(db, job):
    paths = [job.source_path, job.storage_path]
    job.source_path = job.storage_path = None
    job.reserved_bytes = 0
    db.flush()
    for path in paths:
        if path and not media_path_still_in_use(db, path):
            delete_upload_file(path)


def process_job(job_id):
    with SessionLocal() as db:
        job = db.get(MediaImport, job_id)
        if not job or job.status == "cancelled": return
        if not job.platform:
            process_legacy(job_id)
            return
        cropping = job.status == "cropping"
        mode = "clip" if cropping else "local" if job.platform == "local" else "remote"
        source = resolve_upload_file(job.source_path) if mode in ("clip", "local") else job.url
        if not source:
            job.status = "failed"; job.error = "Source file is missing; import it again"; db.commit(); return
        args = [str(source)]
        clip_args = [str(job.start_ms), str(job.end_ms), str(job.volume if job.volume is not None else 1.0)] if cropping else []
    with tempfile.TemporaryDirectory(prefix="screenping-clip-") as temporary:
        output = Path(temporary) / "result.log"
        env = {key: value for key, value in os.environ.items() if key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG")}
        timeout = 180 if cropping else 600
        with output.open("w", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, "-m", "app.services.video_import", mode, *args, temporary, *clip_args],
                                       env=env, stdout=log, stderr=subprocess.DEVNULL, start_new_session=os.name == "posix")
            started = time.monotonic()
            try:
                while process.poll() is None:
                    with SessionLocal() as db:
                        job = db.get(MediaImport, job_id)
                        if not job or job.status == "cancelled" or not settings.video_clip_enabled or not enabled(job.platform) or time.monotonic() - started > timeout:
                            terminate_tree(process); break
                        if job.status in ("fetching", "optimizing", "cropping"):
                            try:
                                progress = json.loads(output.read_text(encoding="utf-8").splitlines()[-1])
                            except (ValueError, IndexError): progress = {}
                            if progress.get("phase") == "optimizing":
                                if job.status == "fetching": job.status = "optimizing"
                                percent = progress.get("progress_percent")
                                if type(percent) is int and 0 <= percent <= 99: job.progress_percent = percent
                                db.commit()
                    time.sleep(0.5)
            finally:
                if process.poll() is None: terminate_tree(process)
        try:
            result = json.loads(output.read_text(encoding="utf-8").splitlines()[-1])
        except (ValueError, IndexError): result = {}
        with SessionLocal() as db:
            job = db.query(MediaImport).filter(MediaImport.id == job_id).with_for_update().first()
            if not job or job.status == "cancelled": return
            if process.returncode != 0 or result.get("error"):
                job.status = "failed"; job.error = result.get("error", "Preparation timed out; try a smaller video")
                clean_job(db, job); db.commit(); return
            previous_source, previous_clip = job.source_path, job.storage_path
            if not cropping:
                source_name = f"source-{job.id}.mp4"
                destination = Path(settings.upload_dir) / source_name
                shutil.copyfile(Path(temporary) / "source.mp4", destination)
                job.source_path = "/uploads/" + source_name
                job.source_duration_ms = result["source_duration_ms"]
                if job.platform != "local": job.title = result.get("title")
                job.start_ms = 0; job.end_ms = min(30000, job.source_duration_ms)
            if result.get("duration_ms"):
                clip_name = f"clip-{job.id}-{uuid.uuid4()}.mp4"
                shutil.copyfile(Path(temporary) / "ready.mp4", Path(settings.upload_dir) / clip_name)
                job.storage_path = "/uploads/" + clip_name
                job.duration_ms = result["duration_ms"]
                job.status = "ready"
            else:
                job.status = "awaiting_selection"
            source_file = resolve_upload_file(job.source_path)
            job.reserved_bytes = (source_file.stat().st_size if source_file else 0) + 3 * FINAL_BYTES
            job.expires_at = utcnow() + timedelta(minutes=5)
            job.error = None
            job.progress_percent = 100
            db.commit()
            for path in (previous_source, previous_clip):
                if path and path not in (job.source_path, job.storage_path) and not media_path_still_in_use(db, path):
                    delete_upload_file(path)


def run():
    # A killed process cannot run TemporaryDirectory cleanup. Only this single
    # worker owns this prefix, and resolved targets must stay in the temp root.
    scratch_root = Path(tempfile.gettempdir()).resolve()
    for candidate in scratch_root.glob("screenping-clip-*"):
        if candidate.is_dir() and not candidate.is_symlink() and candidate.resolve().parent == scratch_root:
            shutil.rmtree(candidate)
    with SessionLocal() as db:
        for job in db.query(MediaImport).filter(MediaImport.status.in_(("fetching", "optimizing", "cropping", "uploading"))):
            job.status = "failed"; job.error = "Preparation interrupted by a restart; please try again"
            clean_job(db, job)
        db.commit()
    while True:
        with SessionLocal() as db:
            for job in db.query(MediaImport).filter(MediaImport.expires_at < utcnow(), MediaImport.status.in_(("ready", "awaiting_selection", "failed", "cancelled"))).with_for_update().all():
                clean_job(db, job); db.delete(job)
            for job in db.query(MediaImport).filter(MediaImport.status.in_(("cancelled", "failed"))).with_for_update().all():
                clean_job(db, job)
            db.commit()
            jobs = db.query(MediaImport).filter(MediaImport.status.in_(("queued", "queued_clip"))).order_by(MediaImport.created_at).all()
            job = next((j for j in jobs if enabled(j.platform or "tiktok") and (not j.platform or settings.video_clip_enabled)), None)
            job_id = job.id if job else None
            if job:
                job.status = "cropping" if job.status == "queued_clip" else "fetching"
                job.progress_percent = 0
            db.commit()
        if job_id: process_job(job_id)
        else: time.sleep(1)


if __name__ == "__main__": run()
