import hashlib
from pathlib import Path
import wave

import numpy as np

SAMPLE_RATE = 44100


def synthesize_music(path: Path, duration_seconds: float, seed: str, sample_rate=SAMPLE_RATE):
    samples = round(duration_seconds * sample_rate)
    tonic = 48 + hashlib.sha256(seed.encode()).digest()[0] % 5
    beat = 60 / 76
    bar = beat * 8
    roots, thirds = np.array([0, 7, 9, 5]), np.array([4, 4, 3, 4])
    melody = np.array([0, 4, 7, 12, 7, 4, 2, 7])
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        for start in range(0, samples, sample_rate):
            t = np.arange(start, min(start + sample_rate, samples), dtype=np.float64) / sample_rate
            chord = (t / bar).astype(np.int64) % len(roots)
            chord_phase = np.remainder(t, bar) / bar
            pad_envelope = np.sin(np.pi * chord_phase) ** 0.35
            pad = np.zeros_like(t)
            for interval in (0, 1, 2):
                semitones = np.where(interval == 1, thirds[chord], interval * 3.5)
                frequency = 440 * 2 ** ((tonic + roots[chord] + semitones - 69) / 12)
                pad += (np.sin(2 * np.pi * frequency * t) + 0.13 * np.sin(4 * np.pi * frequency * t)) / 3
            note = (t / beat).astype(np.int64) % len(melody)
            frequency = 440 * 2 ** ((tonic + 12 + melody[note] - 69) / 12)
            phase = np.remainder(t, beat)
            envelope = (1 - np.exp(-phase * 45)) * np.exp(-phase * 3.3)
            bell = np.sin(2 * np.pi * frequency * t) + 0.2 * np.sin(4 * np.pi * frequency * t)
            signal = 0.23 * pad * pad_envelope + 0.13 * bell * envelope
            fade = min(1.4, duration_seconds / 4)
            signal *= np.minimum(1, np.maximum(0, t / fade))
            signal *= np.minimum(1, np.maximum(0, (duration_seconds - t) / fade))
            stereo = np.column_stack((signal, signal * 0.985))
            output.writeframes(np.rint(np.clip(stereo, -1, 1) * 32767).astype('<i2').tobytes())
    return path
