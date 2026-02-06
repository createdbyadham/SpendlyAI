import { useMutation } from '@tanstack/react-query';

export interface TextRegion {
  text: string;
  confidence: number;
  /** [x_min, y_min, x_max, y_max] */
  box: number[];
  /** [[x1,y1], [x2,y2], [x3,y3], [x4,y4]] */
  polygon: number[][];
}

export interface OCRRegions {
  text_regions: TextRegion[];
  image_width: number;
  image_height: number;
}

export interface ReceiptItem {
  desc: string;
  qty: number;
  price: number;
}

export interface ReceiptData {
  merchant: string | null;
  date: string | null;
  total: number | null;
  tax: number | null;
  items: ReceiptItem[];
}

/** Response from /ocr/scan — fast OCR-only, no LLM */
export interface ScanResponse {
  status: string;
  raw_text: string;
  ocr_regions: OCRRegions;
}

/** Response from /ocr/parse — LLM parsing + ChromaDB storage */
export interface ParseResponse {
  status: string;
  data: ReceiptData;
}

/** Step 1: Fast OCR scan — returns text + bounding boxes */
export const scanReceipt = async (file: File): Promise<ScanResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('http://localhost:8000/ocr/scan', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to scan receipt');
  }

  return response.json();
};

/** Step 2: LLM parse — sends raw_text, returns structured data */
export const parseReceipt = async (rawText: string): Promise<ParseResponse> => {
  const response = await fetch('http://localhost:8000/ocr/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_text: rawText }),
  });

  if (!response.ok) {
    throw new Error('Failed to parse receipt');
  }

  return response.json();
};

export const useScanMutation = () => {
  return useMutation({
    mutationFn: scanReceipt,
  });
};