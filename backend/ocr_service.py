import os
import tempfile
from paddleocr import PaddleOCR
import instructor
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Optional
import logging

# Define the Pydantic models for the receipt
class ReceiptItem(BaseModel):
    desc: str = Field(..., description="Description of the item")
    qty: float = Field(..., description="Quantity of the item")
    price: float = Field(..., description="Price of the item")

class ReceiptData(BaseModel):
    merchant: Optional[str] = Field(None, description="Name of the merchant")
    date: Optional[str] = Field(None, description="Date of the receipt in YYYY-MM-DD format")
    total: Optional[float] = Field(None, description="Total amount of the receipt")
    tax: Optional[float] = Field(None, description="Tax amount")
    items: List[ReceiptItem] = Field(default_factory=list, description="List of items in the receipt")

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
        # Validate text content to avoid sending garbage to LLM
        # "n\na\no..." suggests less than 20 chars of meaningful text usually isn't a receipt
        if not raw_text or len(raw_text.strip()) < 10:
            logging.warning(f"Raw text too short or empty ({len(raw_text) if raw_text else 0} chars), skipping LLM parsing")
            return ReceiptData()

        # Extremely simplified prompt to avoid "jailbreak" detection on weird inputs
        system_prompt = "Extract merchant, date, total, tax, and items from this receipt text into JSON."

        try:
            receipt_data = self.client.chat.completions.create(
                model="gpt-4o-mini",
                response_model=ReceiptData,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": raw_text}
                ]
            )
            return receipt_data
        except Exception as e:
            logging.error(f"Error parsing receipt with LLM: {e}")
            # Return empty structure on failure
            return ReceiptData()
