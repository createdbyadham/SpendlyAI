import os
import tempfile
from paddleocr import PaddleOCR
import instructor
from openai import OpenAI
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
import logging
import re

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

    def extract_text_from_bytes(self, image_bytes: bytes) -> str:
        if not image_bytes:
            logging.warning("Empty image bytes received")
            return ""
        
        # Detect actual image format for correct temp file extension
        suffix = self._detect_image_suffix(image_bytes)
        logging.info(f"Detected image format: {suffix} ({len(image_bytes)} bytes)")
        
        # Create a temp file to store the image
        fd, temp_file_path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(fd, 'wb') as temp_file:
                temp_file.write(image_bytes)
            
            logging.info(f"Processing image at {temp_file_path}")
            
            # Use predict() method per PaddleOCR 3.x docs
            result = self.ocr.predict(temp_file_path)
            
            all_text_lines = []
            
            for res in result:
                # The result object has a .json property returning a dict
                res_json = res.json
                
                # Handle string JSON (parse it if needed)
                if isinstance(res_json, str):
                    import json
                    res_json = json.loads(res_json)
                
                # Find rec_texts - may be at top level or nested under 'res' key
                rec_texts = []
                if isinstance(res_json, dict):
                    if 'rec_texts' in res_json:
                        rec_texts = res_json['rec_texts']
                    elif 'res' in res_json and isinstance(res_json['res'], dict):
                        rec_texts = res_json['res'].get('rec_texts', [])
                
                all_text_lines.extend(rec_texts)
                
            raw_text = "\n".join(all_text_lines)
            logging.info(f"Extracted {len(all_text_lines)} lines total, {len(raw_text)} chars")
            return raw_text

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
