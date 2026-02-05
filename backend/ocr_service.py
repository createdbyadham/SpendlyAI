import os
import cv2
import numpy as np
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
        # Initialize PaddleOCR
        # Using configuration for PaddleOCR v3/v5
        # use_doc_orientation_classify=True enables document orientation classification
        # use_textline_orientation=True enables textline orientation classification (good for wild scenarios)
        # Note: use_gpu is determined by the installed paddlepaddle version (cpu vs gpu), not passed as arg in v3
        self.ocr = PaddleOCR(
            use_doc_orientation_classify=True,
            use_doc_unwarping=False,
            use_textline_orientation=True,
            lang='en'
        )
        
        # Initialize OpenAI client with instructor
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = None
        
        # Check if using GitHub Models
        if api_key and api_key.startswith("github_pat_"):
            base_url = "https://models.github.ai/inference"
            
        self.client = instructor.from_openai(OpenAI(api_key=api_key, base_url=base_url))

    def extract_text_from_bytes(self, image_bytes: bytes) -> str:
        # Save to temp file as PaddleOCR predicts from path
        import tempfile
        import os
        
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
            temp_file.write(image_bytes)
            temp_file_path = temp_file.name
            
        try:
            # Use the predict method as per new docs (v3/v5)
            # result is a list of objects
            results = self.ocr.predict(temp_file_path)
            
            all_text_lines = []
            
            # Iterate through results (usually one per page/image)
            for res in results:
                # The result object has a 'res' attribute which is a dictionary (or it behaves like one?)
                # Based on docs example output: {'res': {'rec_texts': [...], ...}}
                # Use .res attribute if available, or try dict access
                if hasattr(res, 'res') and isinstance(res.res, dict):
                     rec_texts = res.res.get('rec_texts', [])
                     if rec_texts:
                         all_text_lines.extend(rec_texts)
                elif isinstance(res, dict) and 'res' in res:
                     rec_texts = res['res'].get('rec_texts', [])
                     if rec_texts:
                         all_text_lines.extend(rec_texts)
                else:
                    # Fallback for older versions or unexpected structure
                    # Try to inspect structure if needed, or assume it might be the old list of tuples
                    # But since we use predict(), we expect the new structure.
                    # Let's try to be safe.
                    try:
                        # Some versions might return just the list if not full structure
                        pass 
                    except:
                        pass

            raw_text = "\n".join(all_text_lines)
            return raw_text
            
        except Exception as e:
            logging.error(f"OCR extraction failed: {e}")
            # Fallback to legacy .ocr() method if predict() fails or returns unexpected format
            try:
                logging.info("Falling back to legacy ocr() method")
                result = self.ocr.ocr(temp_file_path, cls=True)
                if result and result[0]:
                    return "\n".join([line[1][0] for line in result[0]])
                return ""
            except Exception as e2:
                 logging.error(f"Legacy OCR failed too: {e2}")
                 raise e

    def parse_receipt(self, raw_text: str) -> ReceiptData:
        system_prompt = """
        You are a receipt parsing engine. You will receive raw, messy text extracted from a receipt by an OCR engine. 
        Your job is to extract specific fields and return them in strict JSON format.

        Rules:
        1. Correct common OCR errors (e.g., if you see "Subtota1", treat it as "Subtotal").
        2. If the Merchant Name is not explicit, infer it from the header or logo text.
        3. Date format must be ISO 8601 (YYYY-MM-DD).
        4. Return "null" for missing fields. Do NOT make up data.
        """

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
