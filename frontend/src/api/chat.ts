/**
 * Streams a chat response from the backend via SSE.
 * Calls `onToken` for every chunk received, and `onDone` when complete.
 */
export async function streamChat(
  message: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError?: (error: Error) => void,
) {
  const response = await fetch('http://localhost:8000/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: message }),
  });

  if (!response.ok || !response.body) {
    const err = new Error('Failed to start chat stream');
    onError?.(err);
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines from the buffer
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const payload = line.slice(6); // strip "data: "

        if (payload === '[DONE]') {
          onDone();
          return;
        }

        if (payload.startsWith('[ERROR]')) {
          const err = new Error(payload);
          onError?.(err);
          throw err;
        }

        onToken(payload);
      }
    }

    // If we exited the loop without [DONE], still signal done
    onDone();
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}

/**
 * Clear chat history on the backend.
 */
export async function clearChat() {
  const response = await fetch('http://localhost:8000/ai/chat/clear', {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to clear chat');
  }

  return response.json();
}
