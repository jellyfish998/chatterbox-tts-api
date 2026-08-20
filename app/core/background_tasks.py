"""
Background task processing for long text TTS jobs
"""

import asyncio
import logging
import os
import traceback
import json
import re
import gc
import soundfile as sf
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any
from pydub import AudioSegment, silence

from app.config import Config
from app.core.long_text_jobs import get_job_manager
from app.core.text_processing import split_text_for_long_generation, estimate_processing_time
from app.core.audio_processing import concatenate_audio_files, AudioConcatenationError
from app.api.endpoints.speech import generate_speech_internal, resolve_voice_path_and_language
from app.core.voice_library import get_voice_library
from app.models.long_text import (
    LongTextJobStatus,
    LongTextJobMetadata,
    LongTextChunk
)

from chatterbox.tts import ChatterboxTTS
from chatterbox.tts_turbo import ChatterboxTurboTTS

logger = logging.getLogger(__name__)

# ==============================================================================
# AUDIOBOOK HELPER FUNCTIONS
# ==============================================================================
FOLEY_SET = {
    "gasp", "sigh", "heavy sigh", "groan", "chuckle", "laugh", 
    "cough", "clear throat", "yawn", "grunt", "pant", "snarl"
}

def resolve_voice_file_name(character_name: str, available_voices: list) -> Optional[str]:
    clean_char = re.sub(r'[^a-zA-Z0-9]', '', character_name).lower()
    for v in available_voices:
        if re.sub(r'[^a-zA-Z0-9]', '', v).lower() == clean_char: return v
    for v in available_voices:
        v_clean = re.sub(r'[^a-zA-Z0-9]', '', v).lower()
        if clean_char in v_clean or v_clean in clean_char: return v
    if "Narrator" in available_voices: return "Narrator"
    return available_voices[0] if available_voices else None

def get_safe_ref(primary_path: str, fallback_path: Optional[str] = None, temp_dir: str = "") -> str:
    """🛡️ Bulletproof Safeguard: Pads short references to prevent PyTorch assertions."""
    try:
        if os.path.exists(primary_path) and sf.info(primary_path).duration > 5.2:
            return primary_path
        if fallback_path and os.path.exists(fallback_path) and sf.info(fallback_path).duration > 5.2:
            return fallback_path
        target = fallback_path if fallback_path and os.path.exists(fallback_path) else primary_path
        audio = AudioSegment.from_wav(target)
        while len(audio) < 5500:
            audio += audio
        safe_path = os.path.join(temp_dir, "temp_safe_ref.wav")
        audio.export(safe_path, format="wav")
        return safe_path
    except Exception:
        return primary_path

# ==============================================================================
# LONG TEXT PROCESSOR
# ==============================================================================
class LongTextProcessor:
    """Processes long text TTS jobs in the background"""

    def __init__(self):
        self.job_manager = get_job_manager()
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.is_running = False
        self._worker_task: Optional[asyncio.Task] = None

    async def start(self):
        """Start the background processor"""
        if self.is_running:
            return

        self.is_running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("Long text processor started")

    async def stop(self):
        """Stop the background processor"""
        if not self.is_running:
            return

        self.is_running = False

        for job_id, task in list(self.active_tasks.items()):
            logger.info(f"Cancelling active job: {job_id}")
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

        self.active_tasks.clear()
        logger.info("Long text processor stopped")

    async def submit_job(self, job_id: str):
        """Submit a job for background processing"""
        if not self.is_running:
            raise RuntimeError("Processor is not running")

        await self.job_manager.job_queue.put(job_id)
        logger.info(f"Job {job_id} submitted for processing")

    async def _worker_loop(self):
        """Main worker loop that processes jobs from the queue"""
        logger.info("Background worker loop started")

        while self.is_running:
            try:
                try:
                    job_id = await asyncio.wait_for(
                        self.job_manager.job_queue.get(),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue

                if len(self.active_tasks) >= Config.LONG_TEXT_MAX_CONCURRENT_JOBS:
                    await self.job_manager.job_queue.put(job_id)
                    await asyncio.sleep(1)
                    continue

                task = asyncio.create_task(self._process_job(job_id))
                self.active_tasks[job_id] = task
                task.add_done_callback(lambda t, jid=job_id: self._cleanup_task(jid))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in worker loop: {e}")
                await asyncio.sleep(1)

        logger.info("Background worker loop stopped")

    def _cleanup_task(self, job_id: str):
        if job_id in self.active_tasks:
            del self.active_tasks[job_id]

    async def _process_job(self, job_id: str):
        """Process a single long text job"""
        logger.info(f"Starting processing for job {job_id}")

        try:
            metadata = self.job_manager._load_job_metadata(job_id)
            if not metadata:
                logger.error(f"Job {job_id} metadata not found")
                return

            metadata.status = LongTextJobStatus.PROCESSING
            metadata.processing_started_at = datetime.utcnow()
            self.job_manager._save_job_metadata(metadata)

            input_text = self.job_manager._load_input_text(job_id)
            if not input_text:
                await self._fail_job(job_id, "Input text not found")
                return

            # ==================================================================
            # 🎧 INTERCEPT: ROUTE TO AUDIOBOOK PROCESSOR IF FLAG IS SET
            # ==================================================================
            if metadata.parameters.get("is_audiobook", False):
                await self._process_audiobook_job(job_id, metadata, input_text)
                return
            # ==================================================================

            # Phase 1: Text chunking (Standard Mode)
            await self._update_job_status(job_id, LongTextJobStatus.CHUNKING, "Splitting text into chunks")

            chunks = split_text_for_long_generation(
                input_text,
                max_chunk_size=Config.LONG_TEXT_CHUNK_SIZE
            )

            if not chunks:
                await self._fail_job(job_id, "Failed to split text into chunks")
                return

            metadata.total_chunks = len(chunks)
            self.job_manager._save_job_metadata(metadata)
            self.job_manager._save_chunks_data(job_id, chunks)

            logger.info(f"Job {job_id}: Split into {len(chunks)} chunks")

            # Phase 2: Generate audio for each chunk (Standard Mode)
            await self._update_job_status(job_id, LongTextJobStatus.PROCESSING, f"Generating audio for {len(chunks)} chunks")

            voice_path, language_id = resolve_voice_path_and_language(metadata.voice)

            chunk_audio_files = []
            for i, chunk in enumerate(chunks):
                current_metadata = self.job_manager._load_job_metadata(job_id)
                if current_metadata and current_metadata.status in [LongTextJobStatus.PAUSED, LongTextJobStatus.CANCELLED]:
                    logger.info(f"Job {job_id} was paused/cancelled, stopping processing")
                    return

                current_metadata.current_chunk = i
                self.job_manager._save_job_metadata(current_metadata)

                chunk.processing_started_at = datetime.utcnow()
                chunks[i] = chunk 

                logger.info(f"Job {job_id}: Processing chunk {i+1}/{len(chunks)} ({len(chunk.text)} chars)")

                try:
                    audio_buffer = await generate_speech_internal(
                        text=chunk.text,
                        voice_sample_path=voice_path,
                        language_id=language_id,
                        exaggeration=metadata.parameters.get('exaggeration'),
                        cfg_weight=metadata.parameters.get('cfg_weight'),
                        temperature=metadata.parameters.get('temperature')
                    )

                    chunk_filename = f"chunk_{i+1:03d}.wav"
                    chunk_audio_path = self.job_manager._get_job_file_paths(job_id)['chunks_dir'] / chunk_filename

                    with open(chunk_audio_path, 'wb') as f:
                        f.write(audio_buffer.getvalue())

                    chunk.audio_file = chunk_filename
                    chunk.processing_completed_at = datetime.utcnow()
                    chunk.duration_ms = int((chunk.processing_completed_at - chunk.processing_started_at).total_seconds() * 1000)

                    chunk_audio_files.append(chunk_audio_path)
                    chunks[i] = chunk

                    current_metadata.completed_chunks = i + 1
                    self.job_manager._save_job_metadata(current_metadata)
                    self.job_manager._save_chunks_data(job_id, chunks)

                except Exception as e:
                    logger.error(f"Job {job_id}: Failed to process chunk {i+1}: {e}")
                    chunk.error = str(e)
                    chunks[i] = chunk
                    if i not in current_metadata.failed_chunks:
                        current_metadata.failed_chunks.append(i)
                        self.job_manager._save_job_metadata(current_metadata)
                    continue

            successful_chunks = [f for f in chunk_audio_files if f.exists()]
            if len(successful_chunks) == 0:
                await self._fail_job(job_id, "No chunks were successfully generated")
                return

            # Phase 3: Concatenate audio chunks (Standard Mode)
            await self._update_job_status(job_id, LongTextJobStatus.PROCESSING, "Combining audio chunks")

            try:
                output_filename = f"final.{metadata.output_format}"
                output_path = self.job_manager._get_job_file_paths(job_id)['output_dir'] / output_filename

                concatenation_metadata = concatenate_audio_files(
                    audio_files=successful_chunks,
                    output_path=output_path,
                    output_format=metadata.output_format,
                    silence_duration_ms=Config.LONG_TEXT_SILENCE_PADDING_MS,
                    normalize_volume=False,
                    remove_source_files=False 
                )

                self.job_manager.complete_job(
                    job_id=job_id,
                    output_path=f"output/{output_filename}",
                    output_size_bytes=concatenation_metadata['file_size_bytes'],
                    output_duration_seconds=concatenation_metadata['duration_seconds']
                )

            except AudioConcatenationError as e:
                await self._fail_job(job_id, f"Audio concatenation failed: {e}")
                return

        except asyncio.CancelledError:
            logger.info(f"Job {job_id} processing was cancelled")
            await self._update_job_status(job_id, LongTextJobStatus.CANCELLED, "Processing was cancelled")
            raise
        except Exception as e:
            logger.error(f"Unexpected error processing job {job_id}: {e}")
            logger.error(traceback.format_exc())
            await self._fail_job(job_id, f"Unexpected error: {e}")


    # ==========================================================================
    # 📚 AUDIOBOOK STUDIO DUAL-MODEL PROCESSOR
    # ==========================================================================
    async def _process_audiobook_job(self, job_id: str, metadata: LongTextJobMetadata, input_text: str):
        """Hijacked background processor specifically formatted for Audiobook Studio JSON arrays."""
        logger.info(f"📚 Started Audiobook Studio processor for job {job_id}")
        
        try:
            payload = json.loads(input_text)
            script_lines = payload.get("script_lines", [])
            if not script_lines:
                await self._fail_job(job_id, "Audiobook payload contains no script_lines")
                return

            paths = self.job_manager._get_job_file_paths(job_id)
            temp_dir = paths['output_dir'].parent / "temp"
            temp_dir.mkdir(exist_ok=True)
            
            # Map script lines into LongTextChunks so the React UI Progress Bar works perfectly
            chunks = []
            for i, line in enumerate(script_lines):
                char_name = line.get("character", "Narrator")
                raw_text = line.get("spoken_text", "")
                
                def clean_tag(match):
                    inner = match.group(1).strip().lower()
                    if inner in FOLEY_SET or any(f in inner for f in FOLEY_SET): return " ... "
                    return ""
                
                clean_spoken = re.sub(r'\[(.*?)\]', clean_tag, raw_text)
                clean_spoken = re.sub(r'\s+', ' ', clean_spoken).strip()

                chunk = LongTextChunk(index=i, text=f"{char_name}: {clean_spoken}")
                chunks.append(chunk)

            metadata.total_chunks = len(chunks)
            self.job_manager._save_job_metadata(metadata)
            self.job_manager._save_chunks_data(job_id, chunks)

            await self._update_job_status(job_id, LongTextJobStatus.PROCESSING, "Generating audiobook dialogue")

            voice_lib = get_voice_library()
            saved_voices = [v.name for v in voice_lib.list_voices()]
            if not saved_voices:
                saved_voices = ["Narrator"] 

            # ------------------------------------------------------------------
            # PHASE 1: STANDARD MODEL (DIALOGUE)
            # ------------------------------------------------------------------
            logger.info("Loading Standard Chatterbox on CPU for Audiobook...")
            standard_model = ChatterboxTTS.from_pretrained(device="cpu")
            generated_segments = []

            for idx, line in enumerate(script_lines):
                current_metadata = self.job_manager._load_job_metadata(job_id)
                if current_metadata and current_metadata.status in [LongTextJobStatus.PAUSED, LongTextJobStatus.CANCELLED]:
                    del standard_model
                    gc.collect()
                    return

                chunk = chunks[idx]
                chunk.processing_started_at = datetime.utcnow()
                self.job_manager._save_chunks_data(job_id, chunks)

                char_name = line.get("character", "Narrator")
                voice_name = resolve_voice_file_name(char_name, saved_voices)
                
                voice_info = voice_lib.get_voice(voice_name)
                original_ref = str(voice_info.file_path) if voice_info else os.path.join(Config.VOICE_LIBRARY_DIR, f"{saved_voices[0]}.wav")
                safe_ref = get_safe_ref(original_ref, temp_dir=str(temp_dir))
                base_path = str(temp_dir / f"temp_{idx}_base.wav")
                
                # Smart Resume Detection
                if os.path.exists(base_path):
                    logger.info(f"⏩ Line {idx + 1}: Smart Resume triggered, skipping generation.")
                else:
                    wav_array = standard_model.generate(
                        text=chunk.text.split(":", 1)[-1].strip() if ":" in chunk.text else chunk.text,
                        audio_prompt_path=safe_ref,
                        cfg_weight=line.get("cfg_weight", 0.4),
                        exaggeration=line.get("exaggeration", 0.6)
                    )
                    if hasattr(wav_array, 'cpu'):
                        wav_array = wav_array.squeeze().cpu().numpy()
                    sf.write(base_path, wav_array, 24000)
                
                foley_tags = re.findall(r'\[(.*?)\]', line.get("spoken_text", ""))
                foley_tags = [f"[{t}]" for t in foley_tags if t.strip().lower() in FOLEY_SET or any(f in t.strip().lower() for f in FOLEY_SET)]

                generated_segments.append({
                    "base_audio": base_path,
                    "foley_tags": foley_tags,
                    "safe_ref": safe_ref
                })

                # Register chunk completion to push the UI progress bar forward
                chunk.audio_file = f"temp_{idx}_base.wav"
                chunk.processing_completed_at = datetime.utcnow()
                chunk.duration_ms = int((chunk.processing_completed_at - chunk.processing_started_at).total_seconds() * 1000)
                chunks[idx] = chunk
                
                current_metadata.completed_chunks = idx + 1
                self.job_manager._save_job_metadata(current_metadata)
                self.job_manager._save_chunks_data(job_id, chunks)

            del standard_model
            gc.collect()

            # ------------------------------------------------------------------
            # PHASE 2: TURBO MODEL (FOLEY TAGS)
            # ------------------------------------------------------------------
            has_foley = any(len(s["foley_tags"]) > 0 for s in generated_segments)
            if has_foley:
                await self._update_job_status(job_id, LongTextJobStatus.PROCESSING, "Generating foley tags")
                turbo_model = ChatterboxTurboTTS.from_pretrained(device="cpu")
                
                for idx, seg in enumerate(generated_segments):
                    current_metadata = self.job_manager._load_job_metadata(job_id)
                    if current_metadata and current_metadata.status in [LongTextJobStatus.PAUSED, LongTextJobStatus.CANCELLED]:
                        del turbo_model
                        gc.collect()
                        return

                    seg["foley_audio"] = []
                    if seg["foley_tags"]:
                        foley_ref = seg["safe_ref"]
                        for t_idx, tag in enumerate(seg["foley_tags"]):
                            tag_path = str(temp_dir / f"temp_{idx}_tag_{t_idx}.wav")
                            seg["foley_audio"].append(tag_path)
                            if os.path.exists(tag_path):
                                continue
                            
                            tag_wav = turbo_model.generate(text=tag, audio_prompt_path=foley_ref)
                            if hasattr(tag_wav, 'cpu'):
                                tag_wav = tag_wav.squeeze().cpu().numpy()
                            sf.write(tag_path, tag_wav, 24000)
                            
                del turbo_model
                gc.collect()

            # ------------------------------------------------------------------
            # PHASE 3: TIMELINE EXPANSION & MIXDOWN
            # ------------------------------------------------------------------
            await self._update_job_status(job_id, LongTextJobStatus.PROCESSING, "Mixing and splicing timeline")
            chapter_track = AudioSegment.empty()
            
            for seg in generated_segments:
                base_seg = AudioSegment.from_wav(seg["base_audio"])
                foley_files = seg.get("foley_audio", [])
                
                if foley_files:
                    mixed_line = AudioSegment.empty()
                    if len(base_seg) < 1500:
                        for tag_f in foley_files:
                            mixed_line += AudioSegment.from_wav(tag_f) + AudioSegment.silent(duration=150)
                        mixed_line += base_seg
                    else:
                        pauses = silence.detect_silences(base_seg, min_silence_len=250, silence_thresh=base_seg.dBFS - 14)
                        cur_pos = 0
                        for i, tag_f in enumerate(foley_files):
                            if i < len(pauses):
                                mixed_line += base_seg[cur_pos:pauses[i][0]]
                                mixed_line += AudioSegment.from_wav(tag_f) + AudioSegment.silent(duration=100)
                                cur_pos = pauses[i][1]
                            else:
                                mixed_line += base_seg[cur_pos:]
                                mixed_line += AudioSegment.silent(duration=200) + AudioSegment.from_wav(tag_f)
                                cur_pos = len(base_seg)
                        if cur_pos < len(base_seg):
                            mixed_line += base_seg[cur_pos:]
                    chapter_track += mixed_line
                else:
                    chapter_track += base_seg
                chapter_track += AudioSegment.silent(duration=400)

            # FINAL EXPORT
            output_filename = f"audiobook_mix.{metadata.output_format}"
            output_path = paths['output_dir'] / output_filename
            chapter_track.export(str(output_path), format=metadata.output_format, bitrate="192k")

            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)

            # Complete Job via Native API to enable downloads and history
            self.job_manager.complete_job(
                job_id=job_id,
                output_path=f"output/{output_filename}",
                output_size_bytes=output_path.stat().st_size,
                output_duration_seconds=len(chapter_track) / 1000.0
            )

        except asyncio.CancelledError:
            logger.info(f"Audiobook Job {job_id} processing was cancelled")
            await self._update_job_status(job_id, LongTextJobStatus.CANCELLED, "Processing was cancelled")
            raise
        except Exception as e:
            logger.error(f"Audiobook Job {job_id} Failed: {e}")
            logger.error(traceback.format_exc())
            await self._fail_job(job_id, f"Audiobook processing failed: {e}")

    # ==========================================================================
    # STANDARD HELPERS
    # ==========================================================================
    async def _update_job_status(self, job_id: str, status: LongTextJobStatus, message: str = ""):
        try:
            metadata = self.job_manager._load_job_metadata(job_id)
            if metadata:
                metadata.status = status
                if message:
                    logger.info(f"Job {job_id}: {message}")
                self.job_manager._save_job_metadata(metadata)
        except Exception as e:
            logger.error(f"Failed to update status for job {job_id}: {e}")

    async def _fail_job(self, job_id: str, error_message: str):
        try:
            logger.error(f"Job {job_id} failed: {error_message}")
            metadata = self.job_manager._load_job_metadata(job_id)
            if metadata:
                metadata.status = LongTextJobStatus.FAILED
                metadata.error = error_message
                metadata.processing_completed_at = datetime.utcnow()
                if metadata.processing_started_at:
                    metadata.total_processing_time_ms = int(
                        (metadata.processing_completed_at - metadata.processing_started_at).total_seconds() * 1000
                    )
                self.job_manager._save_job_metadata(metadata)
        except Exception as e:
            logger.error(f"Failed to mark job {job_id} as failed: {e}")

    def get_active_job_count(self) -> int:
        return len(self.active_tasks)

    def get_active_job_ids(self) -> list:
        return list(self.active_tasks.keys())

    async def pause_job(self, job_id: str) -> bool:
        if job_id in self.active_tasks:
            task = self.active_tasks[job_id]
            task.cancel()
            return True
        return False

# Global processor instance
_processor: Optional[LongTextProcessor] = None

def get_processor() -> LongTextProcessor:
    global _processor
    if _processor is None:
        _processor = LongTextProcessor()
    return _processor

async def start_background_processor():
    processor = get_processor()
    await processor.start()

async def stop_background_processor():
    processor = get_processor()
    await processor.stop()