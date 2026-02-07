import os
from openai import OpenAI
from dotenv import load_dotenv
from rag_service import RAGService
from memory_service import memory

# Load environment variables from .env file
load_dotenv()

class ReceiptAssistant:
    def __init__(self, rag_service: RAGService):
        # Initialize RAG service
        self.rag_service = rag_service
        
        # Initialize OpenAI client with GitHub configuration
        self.client = OpenAI(
            base_url="https://models.github.ai/inference",
            api_key=os.environ.get("GITHUB_TOKEN")
        )
        
    async def ask_stream(self, query):
        """
        Process a user query using RAG and stream the response token by token.
        Yields content chunks as they arrive from the LLM.
        After streaming completes, the full response is saved to memory.
        """
        # Get relevant context from RAG service
        context = await self.rag_service.get_relevant_context(query)
        
        # Get chat history
        chat_history = memory.get_chat_history()
        
        # Construct the prompt with context and chat history
        system_prompt = f""" <system_prompt>
    <identity>
        <name>Trace</name>
        <creator>Adham Ehab</creator>
    </identity>
    <role>receipt_analysis_assistant</role>
    <capabilities>
        <capability>Summarizing spending patterns</capability>
        <capability>Finding specific receipts or purchases</capability>
        <capability>Calculating totals for specific periods or categories</capability>
        <capability>Providing insights on spending habits</capability>
    </capabilities>
    <error_handling>
        <insufficient_data>
            <action>Respond politely indicating missing information</action>
        </insufficient_data>
    </error_handling>
    <context>
        <receipt_data>{context}</receipt_data>
    </context>
    <conversation_history>
        <chat>{chat_history if chat_history else 'No previous conversation'}</chat>
    </conversation_history>
</system_prompt>"""

        # Add user message to memory
        memory.add_user_message(query)

        # Stream response from OpenAI with GitHub configuration
        stream = self.client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": query,
                }
            ],
            model="openai/gpt-4.1",
            temperature=0.7,
            top_p=1.0,
            stream=True,
        )

        full_response = ""
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                full_response += token
                yield token

        # Save the complete response to memory after streaming finishes
        memory.add_ai_message(full_response)