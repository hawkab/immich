import math
from pathlib import Path
import textwrap

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

PALETTES = {'family': ((27, 36, 49), (243, 232, 214)),
            'travel': ((17, 52, 59), (233, 242, 231)),
            'celebration': ((63, 27, 53), (255, 226, 184)),
            'nature': ((29, 48, 33), (237, 239, 214)),
            'pets': ((49, 37, 27), (249, 234, 209))}
FONT = Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')


def palette(theme):
    return PALETTES.get(theme, PALETTES['family'])


def font(size):
    return ImageFont.truetype(str(FONT), size=max(1, round(size)))


def preview(path):
    with Image.open(path) as source:
        oriented = ImageOps.exif_transpose(source)
        image = oriented.convert('RGBA')
        background = Image.new('RGBA', image.size, (255, 255, 255, 255))
        background.alpha_composite(image)
        return background.convert('RGB')


def photo_frame(path, width, height, theme='family'):
    image = preview(path)
    background = ImageOps.fit(image, (width, height), method=Image.Resampling.LANCZOS)
    background = background.filter(ImageFilter.GaussianBlur(max(width, height) / 48))
    background = ImageEnhance.Brightness(background).enhance(0.48)
    foreground = ImageOps.contain(image, (round(width * 0.88), round(height * 0.84)),
                                 method=Image.Resampling.LANCZOS)
    left, top = (width - foreground.width) // 2, (height - foreground.height) // 2
    shadow = Image.new('RGBA', (width, height))
    ImageDraw.Draw(shadow).rounded_rectangle((left - 8, top - 8, left + foreground.width + 8,
                                             top + foreground.height + 8), radius=8, fill=(0, 0, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, width / 100)))
    background = background.convert('RGBA')
    background.alpha_composite(shadow)
    background.paste(foreground, (left, top))
    return background.convert('RGB')


def centered_text(canvas, value, top, point_size, color, max_width, *, max_lines=None):
    drawing, face = ImageDraw.Draw(canvas), font(point_size)
    lines = []
    for paragraph in str(value).splitlines() or ['']:
        words, current = paragraph.split(), ''
        for word in words:
            candidate = current + (' ' if current else '') + word
            if drawing.textlength(candidate, font=face) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                chunks = textwrap.wrap(word, width=max(1, round(max_width / max(1, drawing.textlength('M', font=face)))))
                lines.extend(chunks[:-1])
                current = chunks[-1] if chunks else word
        if current:
            lines.append(current)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(' .') + '…'
    line_height = round(point_size * 1.35)
    for index, line in enumerate(lines):
        left = (canvas.width - drawing.textlength(line, font=face)) / 2
        drawing.text((left, top + index * line_height), line, font=face, fill=color)
    return top + len(lines) * line_height


def opening_frame(path, width, height, title, dates, theme):
    canvas = photo_frame(path, width, height, theme).filter(ImageFilter.GaussianBlur(width / 90))
    canvas = ImageEnhance.Brightness(canvas).enhance(0.48)
    accent = palette(theme)[1]
    drawing = ImageDraw.Draw(canvas)
    drawing.line((width * 0.43, height * 0.25, width * 0.57, height * 0.25), fill=accent, width=max(1, width // 400))
    end = centered_text(canvas, title, round(height * 0.32), width / 22, accent, width * 0.82, max_lines=3)
    if dates:
        centered_text(canvas, dates, min(round(height * 0.72), end + height * 0.05), width / 43,
                      (240, 240, 240), width * 0.86)
    return canvas


def collage_frame(items, width, height, title, dates, theme):
    background, accent = palette(theme)
    canvas = Image.new('RGB', (width, height), background)
    centered_text(canvas, title, round(height * 0.035), width / 38, accent, width * 0.9, max_lines=2)
    columns = min(len(items), max(1, math.ceil(math.sqrt(len(items) * width / height))))
    rows = math.ceil(len(items) / columns)
    gap, top, bottom = max(2, width // 120), round(height * 0.19), round(height * 0.9)
    tile_width = (width - gap * (columns + 1)) // columns
    tile_height = (bottom - top - gap * (rows - 1)) // rows
    for index, item in enumerate(items):
        image = preview(item['path'])
        fitted = ImageOps.contain(image, (tile_width, tile_height), method=Image.Resampling.LANCZOS)
        column, row = index % columns, index // columns
        left = gap + column * (tile_width + gap) + (tile_width - fitted.width) // 2
        y = top + row * (tile_height + gap) + (tile_height - fitted.height) // 2
        canvas.paste(fitted, (left, y))
    if dates:
        centered_text(canvas, dates, round(height * 0.94), width / 64, accent, width * 0.94)
    return canvas
