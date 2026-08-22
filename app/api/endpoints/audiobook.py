from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
import os
import re
import shutil
import json
import yt_dlp
import hashlib
from datetime import datetime
from pathlib import Path
from pydub import AudioSegment, effects

from app.config import Config
from app.core.long_text_jobs import get_job_manager
from app.core.background_tasks import _process_audiobook_job
from app.models.requests import AudiobookBatchRequest

base_router = APIRouter()
router = base_router  

class YouTubeExtractionRequest(BaseModel):
    url: str
    start_time: float
    duration: float
    voice_name: str

@base_router.post("/youtube")
def extract_youtube_voice(req: YouTubeExtractionRequest):
    clean_name = re.sub(r'[^a-zA-Z0-9_-]', '_', req.voice_name.strip())
    dest_path = Path(Config.VOICE_LIBRARY_DIR) / f"{clean_name}.wav"
    temp_dir = Path(Config.LONG_TEXT_DATA_DIR) / f"temp_voice_hunter_{clean_name}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        buffer_seconds = 5.0
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': str(temp_dir / 'raw_download'),
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}],
            'quiet': True,
            'download_ranges': lambda info, ctx: [{'start_time': max(0, req.start_time - buffer_seconds), 'end_time': req.start_time + req.duration + buffer_seconds}],
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
            'http_headers': {'User-Agent': 'Mozilla/5.0'}
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([req.url])
            
        downloaded_file = list(temp_dir.glob("raw_download.wav"))[0]
        
        audio = AudioSegment.from_wav(str(downloaded_file))
        audio = effects.normalize(audio)
        
        actual_buffer_ms = min(req.start_time, buffer_seconds) * 1000
        end_ms = actual_buffer_ms + int(req.duration * 1000)
        
        sliced_audio = audio[int(actual_buffer_ms):int(end_ms)].set_frame_rate(24000).set_channels(1)
        
        while len(sliced_audio) < 5500:
            sliced_audio = sliced_audio.append(sliced_audio, crossfade=50)
            
        sliced_audio.export(str(dest_path), format="wav")
        return {"status": "success", "voice": clean_name}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@base_router.post("/generate")
def start_batch_generation(req: AudiobookBatchRequest, background_tasks: BackgroundTasks):
    job_manager = get_job_manager()
    total_length = sum(len(line.spoken_text) for chap in req.chapters for line in chap.script_lines)
    
    # 1. Register with SQLite so the SSE endpoint connects!
    job_id, _ = job_manager.create_job(text=f"Audiobook: {req.project_title}")
        
    # 2. Force the metadata to "processing" in the DB so the standard worker doesn't steal it
    try:
        db_job = None
        for getter_name in ['get_job_metadata', 'get_job_details', 'get_job_record', 'get_metadata', 'get_job']:
            if hasattr(job_manager, getter_name):
                try:
                    db_job = getattr(job_manager, getter_name)(job_id)
                    if db_job: break
                except Exception:
                    pass

        if db_job:
            metadata = getattr(db_job, 'metadata', db_job)
            metadata.status = "processing"
            metadata.total_chunks = max(len(req.chapters), 1)
            metadata.voice = "Multi-Cast Map"
            metadata.output_format = "wav"
            metadata.parameters = req.dict()
            metadata.text_length = max(total_length, 1)
            
            for saver_name in ['save_job_metadata', 'update_job_metadata', 'save_metadata', 'save_job']:
                if hasattr(job_manager, saver_name):
                    try:
                        getattr(job_manager, saver_name)(db_job)
                        break
                    except Exception:
                        try:
                            getattr(job_manager, saver_name)(metadata)
                            break
                        except Exception:
                            pass
    except Exception as e:
        print(f"⚠️ [Audiobook] DB Metadata override failed: {e}")

    # 3. Write securely to disk as a final safeguard
    try:
        job_dir = Path(Config.LONG_TEXT_DATA_DIR) / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = job_dir / "metadata.json"
        
        now_iso = datetime.utcnow().isoformat()
        md = {
            "job_id": job_id,
            "created_at": now_iso,
            "updated_at": now_iso,
            "status": "processing",
            "text_length": max(total_length, 1),
            "text_hash": hashlib.md5(f"audiobook_{job_id}".encode()).hexdigest(),
            "total_chunks": max(len(req.chapters), 1),
            "completed_chunks": 0,
            "failed_chunks": [],
            "current_chunk": 0,
            "voice": "Multi-Cast Map",
            "parameters": req.dict(),
            "processing_started_at": now_iso,
            "output_format": "wav",
            "display_name": f"Audiobook: {req.project_title}",
            "tags": ["audiobook"],
            "is_archived": False,
            "retry_count": 0
        }
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(md, f, indent=4)
    except Exception as e:
        print(f"⚠️ [Audiobook] Disk Metadata override failed: {e}")
        
    background_tasks.add_task(_process_audiobook_job, job_id, req.dict())
    
    return {"job_id": job_id, "status": "processing", "message": "Audiobook batch job queued successfully."}