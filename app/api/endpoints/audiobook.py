# ==============================================================================
# [NEW FILE: app/api/endpoints/audiobook.py]
# ==============================================================================
import os
import re
import shutil
import subprocess
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yt_dlp
from pydub import AudioSegment, effects

from app.core.long_text_jobs import get_job_manager
from app.models.requests import AudiobookBatchRequest
from app.config import Config

base_router = APIRouter()

class YouTubeExtractionRequest(BaseModel):
    url: str
    start_time: float
    duration: float
    voice_name: str

@base_router.post("/youtube")
def extract_youtube_voice(req: YouTubeExtractionRequest):
    # P0-08: Use Config paths to ensure Docker volume persistence
    voices_dir = Path(Config.VOICE_LIBRARY_DIR)
    output_dir = Path(Config.LONG_TEXT_DATA_DIR) / "temp_yt"
    
    voices_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    clean_name = re.sub(r'[^a-zA-Z0-9_\- ]', '_', req.voice_name.strip())
    dest_path = voices_dir / f"{clean_name}.wav"
    temp_dir = output_dir / f"temp_pipeline_{clean_name}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    raw_download_path = temp_dir / "raw_download.wav"

    clean_env = os.environ.copy()
    clean_env.pop("DEVICE", None)
    clean_env["DEVICE"] = "cpu"

    try:
        # Force yt-dlp and ffmpeg to only fetch and process the exact segment we need
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': str(temp_dir / 'raw_download'),
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'wav'}],
            'quiet': True,
            'download_ranges': lambda info, ydl: [{'start_time': req.start_time, 'end_time': req.start_time + req.duration}],
            'extractor_args': {'youtube': {'player_client': ['android', 'web']}},
            'http_headers': {'User-Agent': 'Mozilla/5.0'}
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([req.url])

        subprocess.run(
            ["python", "-m", "demucs", "--two-stems=vocals", "-o", str(temp_dir), str(raw_download_path)],
            check=True, capture_output=True, env=clean_env
        )
        vocal_stem_path = temp_dir / "htdemucs" / "raw_download" / "vocals.wav"

        audio = AudioSegment.from_file(str(vocal_stem_path))
        start_ms = int(req.start_time * 1000)
        end_ms = start_ms + int(req.duration * 1000)
        sliced_audio = audio[start_ms:end_ms].set_frame_rate(24000).set_channels(1)

        sliced_audio = effects.normalize(sliced_audio)

        while len(sliced_audio) < 5500:
            sliced_audio += sliced_audio

        sliced_audio.export(str(dest_path), format="wav")
        
        return {"status": "success", "voice": clean_name}

    except subprocess.CalledProcessError as e:
        err_msg = e.stderr.decode('utf-8', errors='ignore') if e.stderr else str(e)
        raise HTTPException(status_code=500, detail=f"Pipeline crash: {err_msg}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@base_router.post("/generate")
async def start_batch_generation(req: AudiobookBatchRequest):
    from app.core.background_tasks import get_processor
    
    job_manager = get_job_manager()
    processor = get_processor()
    
    req_dict = req.model_dump() if hasattr(req, 'model_dump') else req.dict()
    project_title = req_dict.get("project_title", "Audiobook")
    json_payload = req_dict.get("json_payload", req_dict)

    # 1. Create the official job placeholder so the UI knows it exists
    job_id, _ = job_manager.create_job(
        text=json.dumps(json_payload),
        voice="Audiobook_Batch",
        output_format="mp3"
    )
    
    # 2. Add our custom Audiobook flags to the metadata
    metadata = job_manager._load_job_metadata(job_id)
    if metadata:
        metadata.parameters["is_audiobook"] = True
        metadata.display_name = f"Audiobook: {project_title}"
        job_manager._save_job_metadata(metadata)
        
    # 3. Fire off the background worker natively through the existing processor
    await processor.submit_job(job_id)
    
    return {
        "status": "success", 
        "job_id": job_id,
        "message": "Audiobook generation queued."
    }