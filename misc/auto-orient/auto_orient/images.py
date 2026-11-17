import base64
import hashlib
from io import BytesIO

from PIL import Image, ImageOps


def preview(raw: bytes, longest_edge: int = 1024) -> Image.Image:
    with Image.open(BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    image.thumbnail((longest_edge, longest_edge), Image.Resampling.LANCZOS)
    return image


def rotate(image: Image.Image, clockwise: int) -> Image.Image:
    match clockwise:
        case 0:
            return image.copy()
        case 90:
            return image.transpose(Image.Transpose.ROTATE_270)
        case 180:
            return image.transpose(Image.Transpose.ROTATE_180)
        case 270:
            return image.transpose(Image.Transpose.ROTATE_90)
        case _:
            raise ValueError("Only lossless quarter turns are allowed")


def jpeg(image: Image.Image) -> bytes:
    output = BytesIO()
    image.save(output, format="JPEG", quality=90)
    return output.getvalue()


def data_url(image: Image.Image) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg(image)).decode()


def pixel_digest(image: Image.Image) -> str:
    value = hashlib.sha256(f"{image.mode}:{image.size}".encode())
    value.update(image.tobytes())
    return value.hexdigest()
