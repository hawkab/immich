import json
from pathlib import Path
import subprocess

from .planning import FPS


def run_ffmpeg(arguments, log):
    with Path(log).open('a') as output:
        subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-loglevel', 'error', '-y', *arguments],
                       stdout=subprocess.DEVNULL, stderr=output, check=True)


def encode_segment(image, output, frames, width, height, *, moving, reverse=False, fade_out=True, log):
    duration = frames / FPS
    if moving:
        progress = f'on/{max(1, frames - 1)}'
        zoom = f'1.035-0.035*{progress}' if reverse else f'1+0.035*{progress}'
    else:
        zoom = '1'
    filters = [f"zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={frames}:s={width}x{height}:fps={FPS}"]
    if frames >= 6:
        fade = min(0.28, duration / 5)
        filters.append(f'fade=t=in:st=0:d={fade:.6f}')
        if fade_out:
            filters.append(f'fade=t=out:st={duration - fade:.6f}:d={fade:.6f}')
    filters.append('format=yuv420p')
    run_ffmpeg(['-i', str(image), '-vf', ','.join(filters), '-frames:v', str(frames),
                '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-threads', '1',
                '-filter_threads', '1', '-fflags', '+bitexact', '-flags:v', '+bitexact',
                '-video_track_timescale', str(FPS * 1024), str(output)], log)


def assemble_video(segments, audio, output, title, theme, created_at, log):
    listing = output.with_suffix('.concat.txt')
    listing.write_text(''.join(f"file '{segment.name}'\n" for segment in segments))
    metadata = ['-metadata', 'creation_time=' + created_at] if created_at else []
    run_ffmpeg(['-f', 'concat', '-safe', '0', '-i', str(listing), '-i', str(audio),
                '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                '-fflags', '+bitexact', '-flags:a', '+bitexact', '-shortest', '-movflags', '+faststart',
                '-metadata', 'title=' + title, '-metadata', 'comment=Original procedural soundtrack; theme=' + theme,
                *metadata, str(output)], log)


def probe_video(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                            capture_output=True, text=True, check=True)
    return json.loads(result.stdout)
