import { useMutation } from '@tanstack/react-query';

interface OCRResponse {
  status: string;
  text_lines: string[];
  metadata: {
    business_name: string;
    date: string | null;
    total: string | null;
  };
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