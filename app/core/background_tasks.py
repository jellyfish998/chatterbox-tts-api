import asyncio
import logging
import os
import traceback
import json
import re
import gc
import soundfile as sf
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from pydub import AudioSegment, silence, effects

from app.config import Config
from app.core.long_text_jobs import get_job_manager
from app.core.voice_library import get_voice_library
from app.models.long_text import LongTextJobStatus, LongTextJobMetadata, LongTextChunk

from chatterbox.tts import ChatterboxTTS
try:
    from chatterbox.tts_turbo import ChatterboxTurboTTS
except (ImportError, ModuleNotFoundError):
    ChatterboxTurboTTS = ChatterboxTTS  

logger = logging.getLogger(__name__)

class LongTextProcessor:
    def __init__(self):
        self.is_running = False
        self._task = None

    async def _process_loop(self):
        while self.is_running:
            await asyncio.sleep(2)

    def start(self):
        self.is_running = True
        self._task = asyncio.create_task(self._process_loop())
        logger.info("Long text background processor started")

    def stop(self):
        self.is_running = False
        if self._task:
            self._task.cancel()
        logger.info("Long text background processor stopped")

_global_processor = LongTextProcessor()

async def start_background_processor():
    _global_processor.start()

async def stop_background_processor():
    _global_processor.stop()

def get_processor() -> LongTextProcessor:
    return _global_processor

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

async def _process_audiobook_job(job_id: str, parameters: Dict[str, Any]):
    job_dir = Path(Config.LONG_TEXT_DATA_DIR) / job_id
    output_dir = job_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Bulletproof Device Lookup
    system_device = getattr(Config, 'DEVICE', getattr(Config, 'DEVICE_OVERRIDE', 'auto'))
    
    chapters = parameters.get("chapters", [])
    mapping_dict = parameters.get("mapping_dict", {})
    voice_library = get_voice_library()
    available_voices = [v["name"] for v in voice_library.list_voices()]
    
    chapter_master_paths = []
    
    try:
        for chap_idx, chapter in enumerate(chapters):
            logger.info(f"--- [Audiobook Studio] Processing Chapter {chap_idx+1} of {len(chapters)}: {chapter['title']} ---")
            
            chapter_lines = chapter.get("script_lines", [])
            chapter_segments = []
            
            logger.info(f"--> Initializing Chatterbox Standard (500M) model on {system_device}...")
            standard_model = ChatterboxTTS.from_pretrained(device=system_device)
            
            for line_idx, line in enumerate(chapter_lines):
                char = line["character"]
                text = line["spoken_text"]
                cfg = line.get("cfg_weight", 0.5)
                exagg = line.get("exaggeration", 0.5)
                temp = line.get("temperature", 0.8)
                
                voice_name = mapping_dict.get(char)
                if not voice_name:
                    voice_name = available_voices[0] if available_voices else "Narrator"
                
                ref_path = Path(Config.VOICE_LIBRARY_DIR) / f"{voice_name}.wav"
                
                if not ref_path.exists():
                    alt_mp3 = Path(Config.VOICE_LIBRARY_DIR) / f"{voice_name}.mp3"
                    if alt_mp3.exists():
                        ref_path = alt_mp3
                    else:
                        ref_path = Path(Config.VOICE_SAMPLE_PATH)
                
                if ref_path.exists() and sf.info(str(ref_path)).duration <= 5.2:
                    temp_safe_ref = output_dir / f"{voice_name}_safe_ref.wav"
                    if not temp_safe_ref.exists():
                        audio = AudioSegment.from_file(str(ref_path))
                        while len(audio) < 5500:
                            audio = audio.append(audio, crossfade=50)
                        audio.export(str(temp_safe_ref), format="wav")
                    ref_path = temp_safe_ref
                
                segment_base_path = output_dir / f"chap_{chap_idx}_line_{line_idx}_base.wav"
                manifest_path = output_dir / f"chap_{chap_idx}_line_{line_idx}_manifest.json"
                
                should_generate = True
                expected_hash = hashlib.md5(f"{text}{cfg}{exagg}{temp}{voice_name}".encode()).hexdigest()
                
                if segment_base_path.exists() and manifest_path.exists():
                    with open(manifest_path, 'r') as mf:
                        manifest_data = json.load(mf)
                    if manifest_data.get("hash") == expected_hash:
                        should_generate = False
                        logger.info(f"⏩ [Resume] Chapter {chap_idx+1} Line {line_idx+1}: Validated cache, skipping.")
                
                foley_tags = [t.lower().strip() for t in re.findall(r'\[(.*?)\]', text) if t.lower().strip() in FOLEY_SET]
                clean_dialogue = re.sub(r'\[(.*?)\]', ' ', text)
                clean_dialogue = re.sub(r'\s+', ' ', clean_dialogue).strip()
                
                if should_generate:
                    wav_array = standard_model.generate(
                        text=clean_dialogue if clean_dialogue else "...",
                        audio_prompt_path=str(ref_path),
                        cfg_weight=cfg,
                        exaggeration=exagg,
                        temperature=temp
                    )
                    if hasattr(wav_array, 'cpu'):
                        wav_array = wav_array.squeeze().cpu().numpy()
                    
                    temp_segment = segment_base_path.with_suffix('.tmp.wav')
                    sf.write(str(temp_segment), wav_array, 24000)
                    temp_segment.replace(segment_base_path)
                    
                    with open(manifest_path, 'w') as mf:
                        json.dump({"hash": expected_hash, "text": clean_dialogue, "parameters": {"cfg": cfg, "exagg": exagg, "temp": temp}}, mf)
                
                chapter_segments.append({
                    "character": char,
                    "raw_text": text,
                    "foley_tags": foley_tags,
                    "base_audio": str(segment_base_path),
                    "safe_ref": str(ref_path)
                })
            
            del standard_model
            gc.collect()
            
            logger.info(f"--> Initializing Chatterbox Turbo (350M) model on {system_device}...")
            turbo_model = ChatterboxTurboTTS.from_pretrained(device=system_device)
            
            for line_idx, segment in enumerate(chapter_segments):
                segment["foley_audio"] = []
                for tag_idx, tag in enumerate(segment.get("foley_tags", [])):
                    tag_output_path = output_dir / f"chap_{chap_idx}_line_{line_idx}_tag_{tag_idx}.wav"
                    segment["foley_audio"].append(str(tag_output_path))
                    
                    if not tag_output_path.exists():
                        tag_wav = turbo_model.generate(text=tag, audio_prompt_path=segment["safe_ref"])
                        if hasattr(tag_wav, 'cpu'):
                            tag_wav = tag_wav.squeeze().cpu().numpy()
                        sf.write(str(tag_output_path), tag_wav, 24000)
            
            del turbo_model
            gc.collect()
            
            logger.info("✂️ Splicing Chapter Timeline...")
            chapter_track = AudioSegment.empty()
            
            for line_idx, segment in enumerate(chapter_segments):
                base_seg = AudioSegment.from_wav(segment["base_audio"])
                base_seg = effects.normalize(base_seg).apply_gain(-16.0 - base_seg.dBFS)
                base_seg = base_seg.fade_in(50).fade_out(50)
                
                tags_audio = [AudioSegment.from_wav(f) for f in segment.get("foley_audio", [])]
                
                if tags_audio:
                    pauses = silence.detect_silence(base_seg, min_silence_len=250, silence_thresh=base_seg.dBFS - 14)
                    if pauses and len(base_seg) >= 1500:
                        slice_start = pauses[0][0] + (pauses[0][1] - pauses[0][0]) // 2
                        dialogue_start, dialogue_end = base_seg[:slice_start], base_seg[slice_start:]
                        foley_mix = sum(ta + AudioSegment.silent(duration=100) for ta in tags_audio)
                        base_seg = dialogue_start + foley_mix + dialogue_end
                    else:
                        for ta in tags_audio:
                            base_seg += AudioSegment.silent(duration=150) + ta
                
                chapter_track += base_seg + AudioSegment.silent(duration=350)
                
            try:
                metadata_path = job_dir / "metadata.json"
                if metadata_path.exists():
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        md = json.load(f)
                    md['status'] = "processing"
                    md['completed_chunks'] = chap_idx + 1
                    md['current_chunk'] = chap_idx
                    md['updated_at'] = datetime.utcnow().isoformat()
                    with open(metadata_path, 'w', encoding='utf-8') as f:
                        json.dump(md, f, indent=4)
            except Exception as e:
                logger.error(f"Failed to update metadata: {e}")
            
            chapter_output_path = job_dir / f"Chapter_{chap_idx+1}_{chapter['title'].replace(' ', '_')}.wav"
            chapter_track.export(str(chapter_output_path), format="wav")
            chapter_master_paths.append(str(chapter_output_path))
            
            for segment in chapter_segments:
                if os.path.exists(segment["base_audio"]): os.remove(segment["base_audio"])
                for tf in segment.get("foley_audio", []):
                    if os.path.exists(tf): os.remove(tf)
                manifest_path = segment["base_audio"].replace('_base.wav', '_manifest.json')
                if os.path.exists(manifest_path): os.remove(manifest_path)

        logger.info("💾 Compiling Book from Chapter Masters...")
        master_wav_path = job_dir / "Complete_Audiobook_Compilation.wav"
        
        with open(master_wav_path, 'wb') as outfile:
            for i, chap_path in enumerate(chapter_master_paths):
                audio = AudioSegment.from_wav(chap_path)
                if i > 0: audio = AudioSegment.silent(duration=1500) + audio
                audio.export(outfile, format="wav")
                
        duration_s = sum(sf.info(p).duration for p in chapter_master_paths) + ((len(chapter_master_paths)-1) * 1.5)
        size_bytes = os.path.getsize(str(master_wav_path))
        
        try:
            metadata_path = job_dir / "metadata.json"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    md = json.load(f)
                md['status'] = "completed"
                md['output_path'] = str(master_wav_path)
                md['output_size_bytes'] = size_bytes
                md['output_duration_seconds'] = duration_s
                md['updated_at'] = datetime.utcnow().isoformat()
                md['completion_timestamp'] = datetime.utcnow().isoformat()
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(md, f, indent=4)
        except Exception:
            pass
            
    except Exception as e:
        logger.error(f"❌ [Audiobook Task] Generation failed: {str(e)}")
        try:
            metadata_path = job_dir / "metadata.json"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    md = json.load(f)
                md['status'] = "failed"
                md['error'] = str(e)
                with open(metadata_path, 'w', encoding='utf-8') as f:
                    json.dump(md, f, indent=4)
        except Exception:
            pass