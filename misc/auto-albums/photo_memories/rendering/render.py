import json
from pathlib import Path
import tempfile

from .encoding import assemble_video, encode_segment, probe_video
from .imaging import collage_frame, opening_frame, photo_frame
from .music import synthesize_music
from .planning import FPS, creation_time, date_caption, file_sha256, membership_signature, select_memory_items, timeline


def render_memory(items: list[dict], output_dir: Path, *, title: str, theme: str = 'family',
                  duration_seconds: float = 45, width=1280, height=720) -> dict:
    if width < 2 or height < 2 or width % 2 or height % 2:
        raise ValueError('H.264 YUV420 output dimensions must be positive even integers')
    selected = select_memory_items(items, duration_seconds)
    signature, inputs = membership_signature(items, selected, title=title, theme=theme,
                                             duration_seconds=duration_seconds, width=width, height=height)
    schedule = timeline(duration_seconds)
    duration = schedule['total_frames'] / FPS
    dates = date_caption(items)
    created_at = creation_time(items)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    log = output_dir / 'ffmpeg.log'
    with tempfile.TemporaryDirectory(prefix='.render-', dir=output_dir) as temporary:
        work = Path(temporary)
        opening = work / 'opening.png'
        opening_frame(selected[0]['path'], width * 2, height * 2, title, dates, theme).save(opening)
        collage = work / 'collage.jpg'
        collage_frame(selected, width, height, title, dates, theme).save(collage, quality=94, subsampling=0)
        segments = []

        def segment(image, frames, moving=False, reverse=False, fade_out=True):
            target = work / f'segment-{len(segments):05d}.mp4'
            encode_segment(image, target, frames, width, height, moving=moving, reverse=reverse,
                           fade_out=fade_out, log=log)
            segments.append(target)

        segment(opening, schedule['opening_frames'])
        quotient, remainder = divmod(schedule['photo_frames'], len(selected))
        for index, item in enumerate(selected):
            frame = work / 'current-photo.png'
            photo_frame(item['path'], width * 2, height * 2, theme).save(frame)
            segment(frame, quotient + (index < remainder), moving=True, reverse=bool(index % 2))
            frame.unlink()
        segment(collage, schedule['closing_frames'], fade_out=False)
        music = synthesize_music(work / 'music.wav', duration, signature)
        staged_video = work / 'memory.mp4'
        assemble_video(segments, music, staged_video, title, theme, created_at, log)
        probe = probe_video(staged_video)
        types = {stream['codec_type']: stream for stream in probe['streams']}
        if types.get('video', {}).get('codec_name') != 'h264' or types.get('audio', {}).get('codec_name') != 'aac':
            raise RuntimeError('Rendered memory is missing its H.264 video or original AAC soundtrack')
        video_stream = types['video']
        if (video_stream['width'], video_stream['height']) != (width, height) or int(video_stream['nb_frames']) != schedule['total_frames']:
            raise RuntimeError('Rendered memory is incomplete or has unexpected output dimensions')
        video_target, collage_target = output_dir / 'memory.mp4', output_dir / 'collage.jpg'
        staged_video.replace(video_target)
        collage.replace(collage_target)
    result = {'video': video_target, 'collage': collage_target, 'cover': collage_target,
              'selected_ids': [str(item['id']) for item in selected], 'duration': duration,
              'target_duration': duration_seconds, 'width': width, 'height': height,
              'membership_signature': signature, 'video_sha256': file_sha256(video_target),
              'collage_sha256': file_sha256(collage_target), 'display_previews': inputs,
              'soundtrack': {'kind': 'original_procedural', 'sample_rate': 44100, 'seed': signature},
              'date_caption': dates, 'created_at': created_at,
              'selection': {'candidate_count': len(items), 'selected_count': len(selected),
                  'reason': 'Even chronological coverage; opening and final collage included; about 3.4 seconds per photo.'}}
    serializable = {key: str(value) if isinstance(value, Path) else value for key, value in result.items()}
    (output_dir / 'render.json').write_text(json.dumps(serializable, ensure_ascii=False, indent=2) + '\n')
    return result
