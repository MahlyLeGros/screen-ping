import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.database import Base
from app.models import MediaImport, User, utcnow
from datetime import timedelta
from app.routes import imports
from app.services.video_import import repeat_video


@pytest.mark.parametrize('duration', [0, 1999, 30001, -1])
def test_loop_limits(duration, tmp_path):
    with pytest.raises(ValueError): repeat_video(tmp_path/'absent.mp4', duration)
    with pytest.raises(ValidationError): imports.ClipRequest(start_ms=0,end_ms=6000,playback_duration_ms=duration)


def test_loop_queues_exact_source_bounds_without_changing_source(monkeypatch):
    engine=create_engine('sqlite:///:memory:'); Base.metadata.create_all(engine)
    monkeypatch.setattr(imports.settings,'video_clip_enabled',True)
    monkeypatch.setattr(imports,'check_upload_rate_limit',lambda _:True)
    with Session(engine) as db:
        user=User(id='owner',username='owner',email='loop@example.com',password_hash='unused')
        job=MediaImport(id='loop',user_id='owner',platform='tiktok',url='https://vm.tiktok.com/example/',status='ready',source_path='/uploads/source.mp4',source_duration_ms=10000,start_ms=2000,end_ms=8000,duration_ms=6000,expires_at=utcnow()+timedelta(minutes=5))
        db.add_all([user,job]);db.commit()
        result=imports.select_clip('loop',imports.ClipRequest(start_ms=2000,end_ms=8000,volume=.4,playback_duration_ms=30000),user,db)
        assert result['status']=='queued_clip'
        assert (job.start_ms,job.end_ms,job.duration_ms)==(2000,8000,30000)
        assert job.source_path=='/uploads/source.mp4'
        job.status='ready';db.commit()
        imports.select_clip('loop',imports.ClipRequest(start_ms=0,end_ms=4000),user,db)
        assert job.duration_ms is None  # A normal edit never repeats accidentally.
    engine.dispose()
