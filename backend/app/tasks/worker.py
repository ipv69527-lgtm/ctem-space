from celery import Celery
from app.config import settings
from app.services.space_sync import create_due_sync_tasks_blocking, run_space_sync_blocking

celery_app = Celery(
    "ctem",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    beat_schedule={
        "scan-due-sync-units-every-minute": {
            "task": "scan_due_sync_units",
            "schedule": 60.0,
        },
    },
)


@celery_app.task(name="sync_space_data")
def sync_space_data(task_id: str):
    return run_space_sync_blocking(task_id)


@celery_app.task(name="scan_due_sync_units")
def scan_due_sync_units():
    task_ids = create_due_sync_tasks_blocking()
    for task_id in task_ids:
        sync_space_data.delay(task_id)
    return {"created": len(task_ids), "task_ids": task_ids}
