import chromadb
from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi
from threading import Lock
import logging
import os
import string

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

    def __init__(self):
        with self._lock:
            if not self._is_initialized:
                try:
                    # 1. Dense Embedding Model (Fast)
                    self.embedder = SentenceTransformer("all-MiniLM-L6-v2")
                    
                    # 2. Reranking Model (Smart but Slower)
                    # This model is trained to spot "hallucinations" and irrelevance
                    self.reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
                    
                    # Setup ChromaDB
                    chroma_path = os.path.join(os.getcwd(), "chroma_store")
                    self.chroma_client = chromadb.PersistentClient(path=chroma_path)
                    self.collection = self.chroma_client.get_or_create_collection("receipts")
                    
                    # 3. Initialize Sparse Search (BM25)
                    # We load all documents into memory for keyword search
                    # Note: For production >100k docs, use Elasticsearch/Qdrant
                    self.bm25 = None
                    self.doc_id_map = {} # Map index to Chroma ID
                    self._refresh_bm25()

                    self._is_initialized = True
                    logger.info("Hybrid RAG Service (Dense + Sparse + Rerank) Initialized")
                except Exception as e:
                    logger.error(f"Failed to init RAG: {str(e)}")
                    raise e

    def _tokenize(self, text):
        """Simple tokenizer for BM25: lowercase and remove punctuation"""
        text = text.lower().translate(str.maketrans('', '', string.punctuation))
        return text.split()

    def _refresh_bm25(self):
        """Rebuilds the BM25 index from ChromaDB documents"""
        try:
            # Fetch all documents (OK for <10k receipts)
            # In production, you would maintain this incrementally
            all_docs = self.collection.get()
            documents = all_docs['documents']
            ids = all_docs['ids']
            metadatas = all_docs['metadatas']
            
            if not documents:
                return

            tokenized_corpus = [self._tokenize(doc) for doc in documents]
            self.bm25 = BM25Okapi(tokenized_corpus)
            
            # Map BM25 integer indices back to Chroma IDs and Data
            self.doc_map = {
                i: {"id": ids[i], "doc": documents[i], "meta": metadatas[i]}
                for i in range(len(ids))
            }
            logger.info(f"BM25 Index refreshed with {len(documents)} documents")
        except Exception as e:
            logger.error(f"Error refreshing BM25: {e}")

    def add_receipt(self, text, metadata):
        """Add to Chroma and refresh BM25"""
        # Generate a unique ID based on timestamp
        doc_id = f"receipt_{metadata.get('timestamp')}"

        # Add to Chroma
        self.collection.add(
            documents=[text],
            metadatas=[metadata],
            ids=[doc_id]
        )
        # Refresh BM25 (Simple approach: rebuild. Optimized: partial update)
        self._refresh_bm25()

    async def get_relevant_context(self, query: str, filters: dict = None, top_k: int = 5) -> str:
        # Step 1: Parallel Retrieval
        
        # A. Dense Search (Chroma)
        dense_results = self.collection.query(
            query_embeddings=[self.embedder.encode(query).tolist()],
            n_results=top_k * 2 # Fetch more for reranking
        )
        
        # B. Sparse Search (BM25)
        sparse_results = []
        if self.bm25:
            tokenized_query = self._tokenize(query)
            # Get top N BM25 results
            bm25_scores = self.bm25.get_scores(tokenized_query)
            top_n_indices = sorted(range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True)[:top_k*2]
            sparse_results = [self.doc_map[i] for i in top_n_indices]

        # Step 2: Hybrid Fusion (RRF)
        # We need to map Dense IDs back to data to unify the format
        # (Simplified logic: assumes we can look up data by ID efficiently)
        
        # For this snippet, let's just grab the actual objects for the Reranker
        # We collect ALL unique candidates from both methods
        
        candidates = {}
        
        # Add Dense Candidates
        for i, doc_id in enumerate(dense_results['ids'][0]):
            candidates[doc_id] = {
                'doc': dense_results['documents'][0][i],
                'meta': dense_results['metadatas'][0][i]
            }
            
        # Add Sparse Candidates
        for item in sparse_results:
            candidates[item['id']] = {
                'doc': item['doc'],
                'meta': item['meta']
            }
            
        if not candidates:
            return ""

        # Step 3: Reranking (Cross-Encoder)
        # We pair the query with EVERY candidate and score them
        candidate_ids = list(candidates.keys())
        pairs = [[query, candidates[cid]['doc']] for cid in candidate_ids]
        
        scores = self.reranker.predict(pairs)
        
        # Combine IDs with scores and sort
        scored_candidates = sorted(
            zip(candidate_ids, scores),
            key=lambda x: x[1],
            reverse=True
        )
        
        # Top K Final Results
        final_context = []
        for doc_id, score in scored_candidates[:top_k]:
            # Filter out low relevance (optional threshold)
            if score < 0: continue 
            
            data = candidates[doc_id]
            final_context.append(
                f"Receipt: {data['meta'].get('title')} | "
                f"Date: {data['meta'].get('date')} | "
                f"Total: {data['meta'].get('total')} | "
                f"Match Score: {score:.2f}\n"
                f"Content: {data['doc']}"
            )
            
        return "\n\n".join(final_context)