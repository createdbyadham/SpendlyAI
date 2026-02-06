import os
import tempfile
from paddleocr import PaddleOCR
import instructor
from openai import OpenAI
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from dataclasses import dataclass, field as dc_field
from PIL import Image
import logging
import re
import json

# Define the Pydantic models for the receipt with validation
class ReceiptItem(BaseModel):
    desc: str = Field(..., description="Description of the item")
    qty: float = Field(..., description="Quantity of the item", ge=0)
    price: float = Field(..., description="Unit price of the item", ge=0)

    @field_validator('desc')
    @classmethod
    def clean_description(cls, v: str) -> str:
        """Strip whitespace and ensure non-empty."""
        v = v.strip()
        if not v:
            raise ValueError("Item description cannot be empty")
        return v

class ReceiptData(BaseModel):
    merchant: Optional[str] = Field(None, description="Name of the merchant/store")
    date: Optional[str] = Field(None, description="Date of the receipt in YYYY-MM-DD format")
    total: Optional[float] = Field(None, description="Final total amount on the receipt", ge=0)
    tax: Optional[float] = Field(None, description="Tax amount", ge=0)
    items: List[ReceiptItem] = Field(default_factory=list, description="List of items in the receipt")

    @field_validator('date')
    @classmethod
    def validate_date_format(cls, v: Optional[str]) -> Optional[str]:
        """Ensure date is in YYYY-MM-DD format if provided."""
        if v is None:
            return v
        if not re.match(r'^\d{4}-\d{2}-\d{2}$', v):
            raise ValueError("Date must be in YYYY-MM-DD format")
        return v

    @field_validator('merchant')
    @classmethod
    def clean_merchant(cls, v: Optional[str]) -> Optional[str]:
        """Strip whitespace from merchant name."""
        if v is not None:
            v = v.strip()
            if not v:
                return None
        return v

@dataclass
class TextRegion:
    """A single detected text region with its bounding box."""
    text: str
    confidence: float
    # Bounding box as [x_min, y_min, x_max, y_max]
    box: List[int] = dc_field(default_factory=list)
    # 4-corner polygon as [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    polygon: List[List[int]] = dc_field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "confidence": round(self.confidence, 4),
            "box": self.box,
            "polygon": self.polygon,
        }

@dataclass
class OCRResult:
    """Full OCR result with text, regions, and image metadata."""
    raw_text: str
    text_regions: List[TextRegion] = dc_field(default_factory=list)
    image_width: int = 0
    image_height: int = 0

    def to_dict(self) -> dict:
        return {
            "raw_text": self.raw_text,
            "text_regions": [r.to_dict() for r in self.text_regions],
            "image_width": self.image_width,
            "image_height": self.image_height,
        }


class OCRService:
    def __init__(self):
        # Initialize PaddleOCR following 3.x documentation
        # https://paddlepaddle.github.io/PaddleOCR/main/en/version3.x/pipeline_usage/OCR.html
        self.ocr = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            lang='en'
        )
        
        # Initialize OpenAI client with instructor
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = None
        
        # Check if using GitHub Models
        if api_key and api_key.startswith("github_pat_"):
            base_url = "https://models.github.ai/inference"
            
        self.client = instructor.from_openai(OpenAI(api_key=api_key, base_url=base_url))

    def _detect_image_suffix(self, image_bytes: bytes) -> str:
        """Detect image format from magic bytes and return appropriate file suffix."""
        if image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
            return ".png"
        elif image_bytes[:2] == b'\xff\xd8':
            return ".jpg"
        elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
            return ".webp"
        elif image_bytes[:3] == b'GIF':
            return ".gif"
        elif image_bytes[:4] == b'%PDF':
            return ".pdf"
        elif image_bytes[:2] == b'BM':
            return ".bmp"
        return ".jpg"  # default fallback

    def _get_result_data(self, res_json: dict) -> dict:
        """Extract the inner result dict, handling both flat and nested structures."""
        if isinstance(res_json, str):
            res_json = json.loads(res_json)
        if isinstance(res_json, dict) and 'res' in res_json and isinstance(res_json['res'], dict):
            return res_json['res']
        return res_json if isinstance(res_json, dict) else {}

    def extract_text_from_bytes(self, image_bytes: bytes) -> OCRResult:
        """Run OCR and return text + bounding boxes + image dimensions."""
        if not image_bytes:
            logging.warning("Empty image bytes received")
            return OCRResult(raw_text="")
        
        # Detect actual image format for correct temp file extension
        suffix = self._detect_image_suffix(image_bytes)
        logging.info(f"Detected image format: {suffix} ({len(image_bytes)} bytes)")
        
        # Create a temp file to store the image
        fd, temp_file_path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, 'wb') as temp_file:
                temp_file.write(image_bytes)
            
            # Get image dimensions
            with Image.open(temp_file_path) as img:
                img_width, img_height = img.size
            
            logging.info(f"Processing image {img_width}x{img_height} at {temp_file_path}")
            
            # Use predict() method per PaddleOCR 3.x docs
            result = self.ocr.predict(temp_file_path)
            
            all_text_lines = []
            text_regions = []
            
            for res in result:
                data = self._get_result_data(res.json)
                
                rec_texts = data.get('rec_texts', [])
                rec_scores = data.get('rec_scores', [])
                rec_boxes = data.get('rec_boxes', [])
                rec_polys = data.get('rec_polys', [])
                
                # Convert numpy arrays to plain lists if needed
                if hasattr(rec_scores, 'tolist'):
                    rec_scores = rec_scores.tolist()
                if hasattr(rec_boxes, 'tolist'):
                    rec_boxes = rec_boxes.tolist()
                if hasattr(rec_polys, 'tolist'):
                    rec_polys = rec_polys.tolist()
                
                for i, text in enumerate(rec_texts):
                    score = rec_scores[i] if i < len(rec_scores) else 0.0
                    box = rec_boxes[i] if i < len(rec_boxes) else []
                    poly = rec_polys[i] if i < len(rec_polys) else []
                    
                    # Convert box values to plain ints
                    box = [int(v) for v in box] if box else []
                    poly = [[int(v) for v in pt] for pt in poly] if poly else []
                    
                    all_text_lines.append(text)
                    text_regions.append(TextRegion(
                        text=text,
                        confidence=float(score),
                        box=box,
                        polygon=poly,
                    ))
                
            raw_text = "\n".join(all_text_lines)
            logging.info(f"Extracted {len(all_text_lines)} lines, {len(text_regions)} regions")
            
            return OCRResult(
                raw_text=raw_text,
                text_regions=text_regions,
                image_width=img_width,
                image_height=img_height,
            )

        except Exception as e:
            logging.error(f"OCR extraction failed: {e}", exc_info=True)
            raise e
        finally:
            # Clean up temp file
            try:
                if os.path.exists(temp_file_path):
                    os.unlink(temp_file_path)
            except Exception as e:
                logging.error(f"Failed to cleanup temp file: {e}")

    def parse_receipt(self, raw_text: str) -> ReceiptData:
        """Parse raw OCR text into structured receipt data using LLM."""
        if not raw_text or len(raw_text.strip()) < 10:
            logging.warning(f"Raw text too short or empty ({len(raw_text) if raw_text else 0} chars), skipping LLM parsing")
            return ReceiptData()

        system_prompt = (
            "You are a receipt parser. Extract structured data from the OCR text of a receipt.\n"
            "Rules:\n"
            "- merchant: The store/business name (first line is usually the store name).\n"
            "- date: Convert to YYYY-MM-DD format.\n"
            "- total: The final TOTAL amount paid (after tax), not the subtotal.\n"
            "- tax: The tax amount. Use 0 if not listed.\n"
            "- items: Each purchased item with description, quantity (default 1), and unit price.\n"
            "- Do NOT include subtotal, total, or tax as items.\n"
            "- Fix obvious OCR errors in item names (e.g., '0' that should be 'O', 'l' that should 'I').\n"
            "- If a field cannot be determined, use null."
        )

        try:
            receipt_data = self.client.chat.completions.create(
                model="gpt-4o-mini",
                response_model=ReceiptData,
                temperature=0,
                max_retries=2,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": raw_text}
                ]
            )
            return receipt_data
        except Exception as e:
            logging.error(f"Error parsing receipt with LLM: {e}")
            return ReceiptData()
