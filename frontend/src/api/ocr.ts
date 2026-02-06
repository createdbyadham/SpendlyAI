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

export interface OCRResponse {
  status: string;
  data: ReceiptData;
  raw_text: string;
  ocr_regions: OCRRegions;
}

export const uploadReceipt = async (file: File): Promise<OCRResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('http://localhost:8000/ocr/', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to process receipt');
  }

  return response.json();
};

export const useOCRMutation = () => {
  return useMutation({
    mutationFn: uploadReceipt,
  });
};