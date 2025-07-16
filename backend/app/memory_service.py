from langchain.memory import ConversationBufferMemory
from typing import Dict, List
import json

class MemoryService:
    def __init__(self):
        self.memory = ConversationBufferMemory(
            memory_key="chat_history",
            return_messages=True
        )
        
    def add_user_message(self, message: str) -> None:
        """Add a user message to the conversation history"""
        self.memory.chat_memory.add_user_message(message)
        
    def add_ai_message(self, message: str) -> None:
        """Add an AI message to the conversation history"""
        self.memory.chat_memory.add_ai_message(message)
        
    def get_chat_history(self) -> List[Dict]:
        """Get the current chat history"""
        messages = self.memory.chat_memory.messages
        return [{"role": msg.type, "content": msg.content} for msg in messages]
        
    def clear(self) -> None:
        """Clear the conversation history"""
        self.memory.clear()

# Create a singleton instance
memory = MemoryService()