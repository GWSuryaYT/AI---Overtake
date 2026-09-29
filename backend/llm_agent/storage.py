import chromadb
from .chunker import Chunky
from dotenv import load_dotenv
from google import genai
import os
import uuid
from google.genai import types

load_dotenv()

ai_client = genai.Client(api_key= os.getenv('GEMINI_KEY') )

#intences:
chunk = Chunky()


#resolve context-storage path relative to project root so it works regardless of CWD
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
chroma = chromadb.PersistentClient(os.path.join(_PROJECT_ROOT, 'context-storage'))

collection = chroma.get_or_create_collection('contexts')

def gemini_encodding(text:str):

    responce = ai_client.models.embed_content(
        model="gemini-embedding-2",
        contents= text,
        config=types.EmbedContentConfig(output_dimensionality=1024)
    )

    results = responce.embeddings
    vector = results[0].values

    return vector

def store(para:str, chunk_size:int=30, overlap:int=10):

    #get the text chunks:
    all_chunked_Text = chunk.chunk_maker(paragraph=para, overlap=overlap, chunk_size=chunk_size)

    #now save them
    for a_text in all_chunked_Text:
        collection.add(
            ids=str(uuid.uuid4()),
            documents= a_text,
            embeddings= gemini_encodding(a_text)
        )
    print('💖Successfully stored it in the database. Thank You.')

#tool_call = True when we use normall for ai it will be false
def result(user_request:str, tool_call_id:str ,ktop:int =2, tool_call:bool= False):

    request_vector = gemini_encodding(user_request)

    results = collection.query(
        query_embeddings=request_vector,
        n_results=ktop
    )
    docs = results['documents'][0] if (results and 'documents' in results and results['documents']) else []
    if tool_call:
        a = docs
    else:
        a = [
            {
                "type": "function_result",
                "call_id": tool_call_id,
                "name": "history_context",
                "result": {"contexts": docs}
            }
        ]
    return a