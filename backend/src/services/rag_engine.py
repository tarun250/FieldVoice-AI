import sys
import os
import json
import argparse

# 1. Dependency Guard
try:
    import numpy as np
    import faiss
    from sentence_transformers import SentenceTransformer
except ImportError as e:
    # Print error as JSON so the calling Node process can parse it and exit
    print(json.dumps({"error": f"Missing python dependencies. Ensure faiss-cpu and sentence-transformers are installed: {str(e)}"}))
    sys.exit(2)

def main():
    # Read query and parameters from stdin JSON stream to prevent CLI argument injections
    try:
        input_data = sys.stdin.read().strip()
        params = json.loads(input_data) if input_data else {}
        query_text = params.get("query", "").strip()
        k = int(params.get("k", 2))
    except Exception as e:
        print(json.dumps({"error": f"Failed to parse stdin inputs: {str(e)}"}))
        sys.exit(1)

    # Paths setup
    current_dir = os.path.dirname(os.path.abspath(__file__))
    seeds_dir = os.path.join(current_dir, "..", "db", "seeds")
    vector_store_dir = os.path.join(current_dir, "..", "..", "vector_store")
    os.makedirs(vector_store_dir, exist_ok=True)
 
    index_path = os.path.join(vector_store_dir, "manuals.index")
    manuals_path = os.path.join(seeds_dir, "manuals.json")
 
    if not os.path.exists(manuals_path):
        print(json.dumps({"error": f"manuals.json not found at: {manuals_path}"}))
        sys.exit(3)
 
    # Load manuals data
    with open(manuals_path, "r", encoding="utf-8") as f:
        manuals = json.load(f)
 
    if not manuals:
        print(json.dumps([]))
        sys.exit(0)
 
    # Load local sentence transformer model (MiniLM is small, fast, and runs offline)
    model = SentenceTransformer("all-MiniLM-L6-v2")
 
    # 2. Index Sync Strategy: Build index if missing or if manuals was updated
    build_index = False
    if not os.path.exists(index_path):
        build_index = True
    else:
        # Rebuild if manuals.json is newer than manuals.index
        manuals_mtime = os.path.getmtime(manuals_path)
        index_mtime = os.path.getmtime(index_path)
        if manuals_mtime > index_mtime:
            build_index = True
 
    if build_index:
        # Encode manuals content texts
        contents = [item["content"] for item in manuals]
        embeddings = model.encode(contents, show_progress_bar=False)
        embeddings = np.array(embeddings).astype("float32")
        
        # Normalize vectors for Cosine Similarity (IndexFlatIP with L2 normalized vectors)
        dimension = embeddings.shape[1]
        faiss.normalize_L2(embeddings)
        index = faiss.IndexFlatIP(dimension)
        index.add(embeddings)
        
        # Save FAISS Index binary to disk
        faiss.write_index(index, index_path)
    else:
        # Load FAISS index from disk
        index = faiss.read_index(index_path)
 
    # 3. Vector Query Search
    if not query_text:
        print(json.dumps([]))
        sys.exit(0)
 
    # Encode query and normalize for Cosine Similarity
    query_vector = model.encode([query_text], show_progress_bar=False)
    query_vector = np.array(query_vector).astype("float32")
    faiss.normalize_L2(query_vector)
 
    # Execute search
    search_k = min(k, len(manuals))
    scores, indices = index.search(query_vector, search_k)
 
    # 4. Map index outcomes back to source documents
    results = []
    for score, idx in zip(scores[0], indices[0]):
        if idx < len(manuals) and idx >= 0:
            item = manuals[idx]
            results.append({
                "equipment_id": item["equipment_id"],
                "title": item["title"],
                "content": item["content"],
                "score": float(score)
            })
 
    print(json.dumps(results))
    sys.exit(0)

if __name__ == "__main__":
    main()
