import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

interface ChatResponse {
  response: string;
}

export const useChatMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (message: string): Promise<ChatResponse> => {
      const response = await fetch('http://localhost:8000/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: message }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate and refetch queries after mutation
      queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
};

export const useClearChatMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetch('http://localhost:8000/ai/chat/clear', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to clear chat');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
};

export type { ChatMessage, ChatResponse }; 