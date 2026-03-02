"""
Azure AI Vision OCR backend.

Requires:
    pip install azure-ai-vision-imageanalysis azure-core

Environment variables:
    AZURE_VISION_ENDPOINT   e.g. https://my-resource.cognitiveservices.azure.com/
    AZURE_VISION_KEY        API key from Azure Portal > Keys and Endpoint

For production (container with Managed Identity), omit AZURE_VISION_KEY and
swap AzureKeyCredential for ManagedIdentityCredential from azure-identity.
"""

import logging
import os

from PIL import Image

logger = logging.getLogger(__name__)


def extract_text_with_boxes_azure(image_path: str) -> dict:
    """
    Extract text and word-level bounding boxes using Azure AI Vision Read API.

    Returns the same shape as the Tesseract backend:
        {
            "full_text": str,
            "words": [{"text": str, "bbox": {x,y,w,h}, "conf": float}],
            "image_size": {"w": int, "h": int},
            "ocr_available": bool,
        }
    """
    from azure.ai.vision.imageanalysis import ImageAnalysisClient
    from azure.ai.vision.imageanalysis.models import VisualFeatures
    from azure.core.credentials import AzureKeyCredential

    endpoint = os.environ.get("AZURE_VISION_ENDPOINT", "").rstrip("/")
    key = os.environ.get("AZURE_VISION_KEY", "")

    if not endpoint or not key:
        raise EnvironmentError(
            "AZURE_VISION_ENDPOINT and AZURE_VISION_KEY must be set for OCR_BACKEND=azure"
        )

    # Get image dimensions via Pillow (Azure doesn't return them in the Read response)
    with Image.open(image_path) as img:
        img_w, img_h = img.size

    client = ImageAnalysisClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key),
    )

    with open(image_path, "rb") as f:
        image_data = f.read()

    result = client.analyze(
        image_data=image_data,
        visual_features=[VisualFeatures.READ],
    )

    words = []
    line_texts = []

    if result.read:
        for block in result.read.blocks:
            for line in block.lines:
                # Preserve each line as its own string — normalize_text() will
                # collapse \n to spaces, keeping multi-line phrases intact.
                line_texts.append(line.text)

                for word in line.words:
                    poly = word.bounding_polygon  # list of ImagePoint(x, y)
                    if poly:
                        xs = [p.x for p in poly]
                        ys = [p.y for p in poly]
                        bbox = {
                            "x": min(xs),
                            "y": min(ys),
                            "w": max(xs) - min(xs),
                            "h": max(ys) - min(ys),
                        }
                    else:
                        bbox = None

                    words.append({
                        "text": word.text,
                        "bbox": bbox,
                        "conf": word.confidence if word.confidence is not None else 1.0,
                    })

    full_text = "\n".join(line_texts)

    logger.debug(
        "Azure OCR: %d words across %d lines from %s",
        len(words), len(line_texts), image_path,
    )

    return {
        "full_text": full_text,
        "words": words,
        "image_size": {"w": img_w, "h": img_h},
        "ocr_available": True,
    }
