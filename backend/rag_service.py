import chromadb
from sentence_transformers import CrossEncoder
from rank_bm25 import BM25Okapi
from threading import Lock
from datetime import datetime
import logging
import os
import string
import uuid

logger = logging.getLogger(__name__)


# ── RAG Service (Singleton) ────────────────────────────────────────
#
# Embedding strategy:
#   ChromaDB 1.0.x ships with a built-in ONNX `all-MiniLM-L6-v2`
#   embedding function ("default").  We let ChromaDB own the entire
#   dense-embedding lifecycle (index + query) so there is zero chance
#   of a vector-space mismatch between stored docs and queries.
#   → documents are passed via `documents=`
#   → queries   are passed via `query_texts=`
#
# Reranking:
#   We load a CrossEncoder (ms-marco-MiniLM-L-6-v2) with an ONNX
#   backend for fast CPU inference.  Falls back to PyTorch if the
#   optimum / onnxruntime stack is missing.

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
                    # 1. Cross-Encoder Reranker ─ prefer ONNX, fallback PyTorch
                    self.reranker = self._load_reranker()

                    # 2. ChromaDB ─ uses its built-in ONNX all-MiniLM-L6-v2
                    #    Do NOT pass a custom embedding_function; that would
                    #    conflict with collections already persisted with the
                    #    "default" config in ChromaDB 1.0.x.
                    chroma_path = os.path.join(os.getcwd(), "chroma_store")
                    self.chroma_client = chromadb.PersistentClient(path=chroma_path)
                    self.collection = self.chroma_client.get_or_create_collection(
                        name="receipts",
                    )

                    # 3. Sparse Search (BM25) ─ kept in-memory
                    self.bm25 = None
                    self.doc_map: dict[int, dict] = {}
                    self._refresh_bm25()

                    self._is_initialized = True
                    logger.info("Hybrid RAG Service (Dense + Sparse + Rerank) initialized")
                except Exception as e:
                    logger.error(f"Failed to init RAG: {e}")
                    raise

    # ── Model Loader ────────────────────────────────────────────────

    @staticmethod
    def _load_reranker() -> CrossEncoder:
        model_name = "cross-encoder/ms-marco-MiniLM-L-6-v2"
        try:
            model = CrossEncoder(model_name, backend="onnx")
            logger.info(f"Reranker '{model_name}' loaded with ONNX backend")
            return model
        except Exception as e:
            logger.warning(f"ONNX unavailable for reranker ({e}); falling back to PyTorch")
            return CrossEncoder(model_name)

    # ── Helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _make_id() -> str:
        """Collision-free receipt ID: timestamp + short UUID."""
        ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        return f"receipt_{ts}_{uuid.uuid4().hex[:8]}"

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        """Simple BM25 tokenizer: lowercase, strip punctuation, split."""
        return text.lower().translate(
            str.maketrans("", "", string.punctuation)
        ).split()

    def _refresh_bm25(self):
        """Rebuild the in-memory BM25 index from all ChromaDB documents."""
        try:
            all_docs = self.collection.get()
            documents = all_docs["documents"]
            ids = all_docs["ids"]
            metadatas = all_docs["metadatas"]

            if not documents:
                self.bm25 = None
                self.doc_map = {}
                return

            tokenized_corpus = [self._tokenize(doc) for doc in documents]
            self.bm25 = BM25Okapi(tokenized_corpus)

            self.doc_map = {
                i: {"id": ids[i], "doc": documents[i], "meta": metadatas[i]}
                for i in range(len(ids))
            }
            logger.info(f"BM25 index refreshed with {len(documents)} documents")
        except Exception as e:
            logger.error(f"Error refreshing BM25: {e}")

    # ── Public API ──────────────────────────────────────────────────

    def add_receipt(self, text: str, metadata: dict) -> str:
        """
        Single entry-point for storing any receipt.
        - Generates a collision-free ID
        - Normalises metadata to ChromaDB-safe types
        - Adds to ChromaDB (embedded by ChromaDB's built-in ONNX model)
        - Refreshes the BM25 index
        Returns the generated document ID.
        """
        doc_id = self._make_id()

        # Normalise metadata ─ ChromaDB only accepts str | int | float | bool
        clean_meta = {
            "source":     str(metadata.get("source", "receipt_ocr")),
            "title":      str(metadata.get("title", "Unknown")),
            "date":       str(metadata.get("date", "Unknown")),
            "total":      float(metadata.get("total", 0.0)),
            "tax":        float(metadata.get("tax", 0.0)),
            "item_count": int(metadata.get("item_count", 0)),
            "timestamp":  str(metadata.get("timestamp", datetime.now().isoformat())),
        }

        self.collection.add(
            documents=[text],
            metadatas=[clean_meta],
            ids=[doc_id],
        )

        self._refresh_bm25()
        logger.info(f"Stored receipt {doc_id} ('{clean_meta['title']}')")
        return doc_id

    async def get_relevant_context(self, query: str, top_k: int = 5) -> str:
        """
        Hybrid retrieval pipeline:
          1. Dense search  (ChromaDB cosine similarity via built-in ONNX embedder)
          2. Sparse search (BM25 keyword matching)
          3. Merge & deduplicate candidates
          4. Rerank with Cross-Encoder
          5. Format top-k for the LLM context window
        """
        doc_count = self.collection.count()
        if doc_count == 0:
            return ""

        fetch_k = min(top_k * 2, doc_count)

        # ── 1. Dense retrieval ──────────────────────────────────────
        # query_texts lets ChromaDB embed with its own ONNX model
        dense_results = self.collection.query(
            query_texts=[query],
            n_results=fetch_k,
        )

        # ── 2. Sparse retrieval (BM25) ─────────────────────────────
        sparse_results: list[dict] = []
        if self.bm25 and self.doc_map:
            tokenized_query = self._tokenize(query)
            bm25_scores = self.bm25.get_scores(tokenized_query)
            top_indices = sorted(
                range(len(bm25_scores)),
                key=lambda i: bm25_scores[i],
                reverse=True,
            )[:fetch_k]
            sparse_results = [
                self.doc_map[i] for i in top_indices if i in self.doc_map
            ]

        # ── 3. Merge candidates (deduplicate by doc ID) ────────────
        candidates: dict[str, dict] = {}

        for i, doc_id in enumerate(dense_results["ids"][0]):
            candidates[doc_id] = {
                "doc": dense_results["documents"][0][i],
                "meta": dense_results["metadatas"][0][i],
            }

        for item in sparse_results:
            if item["id"] not in candidates:
                candidates[item["id"]] = {
                    "doc": item["doc"],
                    "meta": item["meta"],
                }

        if not candidates:
            return ""

        # ── 4. Rerank with Cross-Encoder ────────────────────────────
        candidate_ids = list(candidates.keys())
        pairs = [[query, candidates[cid]["doc"]] for cid in candidate_ids]

        scores = self.reranker.predict(pairs)

        scored = sorted(
            zip(candidate_ids, scores),
            key=lambda x: x[1],
            reverse=True,
        )

        # ── 5. Format final context ────────────────────────────────
        final_context: list[str] = []
        for doc_id, score in scored[:top_k]:
            if score < -5:  # very lenient; cross-encoder logits range ~[-11, +11]
                continue

            meta = candidates[doc_id]["meta"]
            final_context.append(
                f"[Receipt ID: {doc_id}]\n"
                f"Merchant: {meta.get('title', 'Unknown')} | "
                f"Date: {meta.get('date', 'N/A')} | "
                f"Total: ${float(meta.get('total', 0)):.2f} | "
                f"Tax: ${float(meta.get('tax', 0)):.2f} | "
                f"Items: {meta.get('item_count', 0)} | "
                f"Relevance: {float(score):.2f}\n"
                f"Content:\n{candidates[doc_id]['doc']}"
            )

        return "\n\n---\n\n".join(final_context)
