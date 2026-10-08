"""Run exactly one worker service. Extraction runs in a killable subprocess."""
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

from app.config import settings
from app.database import SessionLocal
from app.models import MediaImport, utcnow
from app.services.media_access import media_path_still_in_use


def terminate_tree(process):
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    else:
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    process.wait()


def process_job(job_id: str):
    with tempfile.TemporaryDirectory(prefix="screenping-import-") as temporary:
        with SessionLocal() as db:
            job = db.get(MediaImport, job_id)
            if not job or job.status == "cancelled":
                return
            url = job.url
        # Do not pass application secrets to the extractor.
        env = {key: value for key, value in os.environ.items() if key in ("PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "LANG")}
        output = Path(temporary) / "progress.log"
        with output.open("w", encoding="utf-8") as log:
            process = subprocess.Popen([sys.executable, "-m", "app.services.tiktok_extract", url, temporary],
                                       env=env, stdout=log, stderr=subprocess.DEVNULL, start_new_session=os.name == "posix")
            start = time.monotonic()
            try:
                while process.poll() is None:
                    with SessionLocal() as db:
                        job = db.get(MediaImport, job_id)
                        if not settings.tiktok_import_enabled or not job or job.status == "cancelled" or time.monotonic() - start > settings.tiktok_import_timeout_seconds:
                            terminate_tree(process)
                            break
                        if "optimizing" in output.read_text(encoding="utf-8") and job.status != "optimizing":
                            job.status = "optimizing"
                            db.commit()
                    time.sleep(0.5)
            finally:
                if process.poll() is None:
                    terminate_tree(process)
        lines = output.read_text(encoding="utf-8").splitlines()
        try:
            result = json.loads(lines[-1])
        except (ValueError, IndexError):
            result = {}
        with SessionLocal() as db:
            job = db.query(MediaImport).filter(MediaImport.id == job_id).with_for_update().first()
            if not job or job.status == "cancelled":
                return
            ready = Path(temporary) / "ready.mp4"
            if process.returncode == 0 and ready.is_file() and result.get("duration_ms"):
                filename = f"import-{job.id}.mp4"
                destination = Path(settings.upload_dir) / filename
                shutil.copyfile(ready, destination)
                job.storage_path = f"/uploads/{filename}"
                job.duration_ms = result["duration_ms"]
                job.status = "ready"
                job.expires_at = utcnow() + timedelta(minutes=5)
            else:
                job.status = "failed"
                job.error = result.get("error", "Import timed out or was interrupted. Upload the video manually.")
            db.commit()


def run():
    with SessionLocal() as db:
        # A crash cannot strand a job forever; no duplicate downloads on restart.
        for job in db.query(MediaImport).filter(MediaImport.status.in_(("fetching", "optimizing"))):
            job.status = "failed"
            job.error = "Import interrupted by a restart; please try again"
        db.commit()
    while True:
        with SessionLocal() as db:
            for job in db.query(MediaImport).filter(MediaImport.expires_at < utcnow()).all():
                if job.storage_path and not media_path_still_in_use(db, job.storage_path):
                    (Path(settings.upload_dir) / Path(job.storage_path).name).unlink(missing_ok=True)
                db.delete(job)
            for job in db.query(MediaImport).filter(MediaImport.status == "cancelled").all():
                if job.storage_path and not media_path_still_in_use(db, job.storage_path):
                    (Path(settings.upload_dir) / Path(job.storage_path).name).unlink(missing_ok=True)
                job.storage_path = None
            job = db.query(MediaImport).filter(MediaImport.status == "queued").order_by(MediaImport.created_at).first() if settings.tiktok_import_enabled else None
            job_id = job.id if job else None
            if job:
                job.status = "fetching"
            db.commit()
        if job_id:
            process_job(job_id)
        else:
            time.sleep(1)


if __name__ == "__main__":
    run()
