from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from dotenv import load_dotenv
from llm_service import ReceiptAssistant
from rag_service import RAGService
from memory_service import memory
from datetime import datetime
from doctr.io import DocumentFile
from doctr.models import ocr_predictor
import logging
from pymongo import MongoClient
from pydantic import BaseModel, ValidationError
import os


# env + intilize services
load_dotenv()
app = FastAPI()
rag_service = RAGService()
ai = ReceiptAssistant(rag_service=rag_service)
MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI environment variable is not set")
client = MongoClient(MONGODB_URI)
db = client["receipts_db"]
receipts_collection = db["receipts"]
ocr_model = ocr_predictor(det_arch='db_resnet50', reco_arch='crnn_vgg16_bn', pretrained=True)

# Validate services on startup
@app.on_event("startup")
async def validate_services():
    try:
        _ = rag_service.collection.count()
        logging.info("RAG service initialized successfully")
        
        # Initialize and validate memory service
        _ = memory.get_chat_history()
        logging.info("Memory service initialized successfully")
        
    except Exception as e:
        logging.error(f"Failed to initialize services: {str(e)}")
        raise RuntimeError(f"Failed to initialize services: {str(e)}")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ReceiptChatRequest(BaseModel):
    query: str

class ReceiptChatResponse(BaseModel):
    response: str

class ReceiptData(BaseModel):
    title: str
    total: float
    date: str
    items: list[dict]
    raw_text: str

def extract_raw_text(ocr_output):
    text_lines = []
    
    for page in ocr_output["pages"]:
        for block in page["blocks"]:
            for line in block["lines"]:
                line_text = " ".join(word["value"] for word in line["words"])
                if line_text.strip():  # Only add non-empty lines
                    text_lines.append(line_text)
    
    return text_lines

@app.post("/ocr/")
async def ocr_endpoint(file: UploadFile = File(...)):
    try:
        # Read the uploaded image file
        image_bytes = await file.read()
        img = DocumentFile.from_images([image_bytes])

        # Run OCR
        result = ocr_model(img)
        ocr_output = result.export()
        
        # Extract the text lines
        text_lines = extract_raw_text(ocr_output)
        
        # Combine all lines into a single text document
        full_text = "\n".join(text_lines)
        
        # Extract basic metadata from the text
        # Try to find date and total amount
        date = None
        total = None
        business_name = text_lines[0] if text_lines else "Unknown Business"  # First line is usually business name
        
        import re
        
        for i, line in enumerate(text_lines):
            line_lower = line.lower().strip()
            
            # Look for date in common formats
            if date is None:
                # Check for date patterns like MM/DD/YYYY, DD-MM-YYYY, etc.
                date_patterns = [
                    r'\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}',  # MM/DD/YYYY or DD-MM-YYYY
                    r'\d{4}[/\-\.]\d{1,2}[/\-\.]\d{1,2}',    # YYYY-MM-DD
                ]
                for pattern in date_patterns:
                    match = re.search(pattern, line)
                    if match:
                        date = match.group()
                        break
                if date is None and any(ind in line_lower for ind in ["date:", "date "]):
                    date = line
            
            # Look for total amount - check if "total" is on this line
            if total is None and "total" in line_lower and "subtotal" not in line_lower:
                # Try to find a number on the same line
                numbers = re.findall(r'[\d]+\.[\d]+|[\d]+', line)
                if numbers:
                    # Get the last number on the line (usually the total value)
                    total = numbers[-1]
                elif i + 1 < len(text_lines):
                    # Check the next line for a number
                    next_line = text_lines[i + 1]
                    numbers = re.findall(r'[\d]+\.[\d]+|[\d]+', next_line)
                    if numbers:
                        total = numbers[0]

        # Store in ChromaDB with metadata (ChromaDB doesn't accept None values)
        rag_service.collection.add(
            documents=[full_text],
            metadatas=[{
                "source": "receipt_ocr",
                "business_name": business_name,
                "date": date if date else "Unknown",
                "total": total if total else "Unknown",
                "timestamp": datetime.now().isoformat()
            }],
            ids=[f"receipt_{datetime.now().timestamp()}"]
        )
        
        return JSONResponse(content={
            "status": "success",
            "text_lines": text_lines,
            "metadata": {
                "business_name": business_name,
                "date": date if date else "Not detected",
                "total": total if total else "Not detected"
            }
        })
        
    except Exception as e:
        logging.error(f"Error processing receipt: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/chat", response_model=ReceiptChatResponse)
async def receipt_chat(request: ReceiptChatRequest):
    try:
        response = await ai.ask(request.query)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/receipts/store")
async def store_receipt(receipt: ReceiptData):
    try:
        logging.info(f"Processing receipt store request for {receipt.title}")
        # Use RAGService instance
        collection = rag_service.collection
        
        # Format the receipt data into a document
        receipt_text = f"""
Receipt from: {receipt.title}
Date: {receipt.date}
Total: ${receipt.total:.2f}

Items:
{chr(10).join([f"- {item['name']}: ${item['price']}" for item in receipt.items])}

Raw OCR Text:
{receipt.raw_text}
"""
        
        # Store in ChromaDB with metadata
        collection.add(
            documents=[receipt_text],
            metadatas=[{
                "title": receipt.title,
                "date": receipt.date,
                "total": receipt.total,
                "timestamp": datetime.now().isoformat()
            }],
            ids=[f"receipt_{datetime.now().timestamp()}"]
        )
        
        logging.info(f"Successfully stored receipt for {receipt.title}")
        return {"status": "success", "message": "Receipt stored successfully"}
    except ValidationError as e:
        logging.error(f"Validation error while processing receipt: {str(e)}")
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logging.error(f"Error storing receipt: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/chat/clear")
async def clear_chat_history():
    try:
        memory.clear()
        return {"status": "success", "message": "Chat history cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    error_details = []
    for error in exc.errors():
        error_details.append({
            'loc': ' -> '.join(str(loc) for loc in error['loc']),
            'msg': error['msg'],
            'type': error['type']
        })
    logging.error(f"Validation error in request to {request.url}: {error_details}")
    return HTTPException(status_code=422, detail=error_details)

@app.on_event("shutdown")
async def shutdown_services():
    try:
        # Close ChromaDB client
        rag_service.chroma_client.close()
        logging.info("Services shut down successfully")
    except Exception as e:
        logging.error(f"Error during shutdown: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000) 