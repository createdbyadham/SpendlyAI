from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from dotenv import load_dotenv
from llm_service import ReceiptAssistant
from rag_service import RAGService
from memory_service import memory
from ocr_service import OCRService
from datetime import datetime
import logging
from pymongo import MongoClient
import os


# env + intilize services
load_dotenv()
app = FastAPI()
rag_service = RAGService()
ai = ReceiptAssistant(rag_service=rag_service)
ocr_service = OCRService()

MONGODB_URI = os.getenv("MONGODB_URI")
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI environment variable is not set")
client = MongoClient(MONGODB_URI)
db = client["receipts_db"]
receipts_collection = db["receipts"]

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

# Model for storing receipts (keeping existing structure for compatibility)
class StoreReceiptRequest(BaseModel):
    title: str
    total: float
    date: str
    items: list[dict]
    raw_text: str

class ParseReceiptRequest(BaseModel):
    raw_text: str

# Step 1: Fast OCR-only — returns text + bounding boxes for the scanning animation
@app.post("/ocr/scan")
async def ocr_scan_endpoint(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        ocr_result = ocr_service.extract_text_from_bytes(image_bytes)

        return JSONResponse(content={
            "status": "success",
            "raw_text": ocr_result.raw_text,
            "ocr_regions": {
                "text_regions": [r.to_dict() for r in ocr_result.text_regions],
                "image_width": ocr_result.image_width,
                "image_height": ocr_result.image_height,
            }
        })

    except Exception as e:
        logging.error(f"Error scanning receipt: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Step 2: LLM parse + ChromaDB storage — called in parallel with the animation
@app.post("/ocr/parse")
async def ocr_parse_endpoint(request: ParseReceiptRequest):
    try:
        parsed_data = ocr_service.parse_receipt(request.raw_text)

        # Prepare structured document for ChromaDB
        merchant_name = parsed_data.merchant if parsed_data.merchant else "Unknown Business"
        date = parsed_data.date if parsed_data.date else "Unknown"
        total = parsed_data.total if parsed_data.total else 0.0
        tax = parsed_data.tax if parsed_data.tax else 0.0

        items_text = "\n".join(
            [f"- {item.desc}: ${item.price:.2f} (qty: {item.qty})"
             for item in parsed_data.items]
        ) if parsed_data.items else "No items extracted"

        structured_doc = (
            f"Receipt from: {merchant_name}\n"
            f"Date: {date}\n"
            f"Total: ${total:.2f}\n"
            f"Tax: ${tax:.2f}\n\n"
            f"Items:\n{items_text}"
        )

        # Store in ChromaDB with metadata
        if request.raw_text and request.raw_text.strip():
            rag_service.collection.add(
                documents=[structured_doc],
                metadatas=[{
                    "source": "receipt_ocr",
                    "title": merchant_name,
                    "date": date,
                    "total": total,
                    "tax": tax,
                    "item_count": len(parsed_data.items),
                    "timestamp": datetime.now().isoformat()
                }],
                ids=[f"receipt_{datetime.now().timestamp()}"]
            )
        else:
            logging.warning("Skipping RAG storage for receipt with empty text")

        return JSONResponse(content={
            "status": "success",
            "data": parsed_data.model_dump(),
        })

    except Exception as e:
        logging.error(f"Error parsing receipt: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ai/chat", response_model=ReceiptChatResponse)
async def receipt_chat(request: ReceiptChatRequest):
    try:
        response = await ai.ask(request.query)
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/receipts/store")
async def store_receipt(receipt: StoreReceiptRequest):
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
{chr(10).join([f"- {item.get('name', item.get('desc', 'Item'))}: ${item.get('price', 0)}" for item in receipt.items])}

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
