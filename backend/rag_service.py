import chromadb
from sentence_transformers import SentenceTransformer
from threading import Lock
import logging
import os

logger = logging.getLogger(__name__)

class RAGService:
    _instance = None
    _lock = Lock()
    _is_initialized = False
    
    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(RAGService, cls).__new__(cls)
        return cls._instance

    def __init__(self, embedder=None):
        with self._lock:
            if not self._is_initialized:
                try:
                    self.embedder = embedder if embedder else SentenceTransformer(
                        "all-MiniLM-L6-v2")
                    
                    # Ensure ChromaDB directory exists
                    chroma_path = os.path.join(os.getcwd(), "chroma_store")
                    os.makedirs(chroma_path, exist_ok=True)
                    
                    self.chroma_client = chromadb.PersistentClient(
                        path=chroma_path)
                    self.collection = self.chroma_client.get_or_create_collection("receipts")
                    self._is_initialized = True
                    logger.info(f"RAGService initialized successfully at {chroma_path}")
                except Exception as e:
                    logger.error(f"Failed to initialize RAGService: {str(e)}")
                    raise RuntimeError(f"Failed to initialize RAGService: {str(e)}")

    async def get_relevant_context(self, query: str, n_results: int = 3) -> str:
        """
        Get relevant context from ChromaDB based on the query.

        Args:
            query: The user's query
            n_results: Number of relevant chunks to retrieve

        Returns:
            A string containing the relevant context
        """
        # Generate embedding for the query
        query_embedding = self.embedder.encode(query).tolist()

        # Query the collection
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["documents", "metadatas"]
        )

        # Format the results into a context string
        context_chunks = []
        for doc, metadata in zip(results['documents'][0], results['metadatas'][0]):
            source = metadata.get('title', 'Unknown')
            date = metadata.get('date', 'Unknown date')
            context_chunks.append(f"Receipt from {source} (Date: {date}):\n{doc}\n")

        return "\n".join(context_chunks)

    def get_sources_used(self, query: str, n_results: int = 3) -> list:
        """
        Get the sources of the documents used for context.

        Args:
            query: The user's query
            n_results: Number of relevant chunks to retrieve

        Returns:
            List of source filenames used
        """
        query_embedding = self.embedder.encode(query).tolist()
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results,
            include=["metadatas"]
        )

        sources = [meta.get('title', 'Unknown')
                   for meta in results['metadatas'][0]]
        return list(set(sources))  # Remove duplicates
