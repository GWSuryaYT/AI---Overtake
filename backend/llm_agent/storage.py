import chromadb
from .chunker import Chunky
from dotenv import load_dotenv
from google import genai
import os
import uuid

load_dotenv()

ai_client = genai.Client(api_key= os.getenv('GEMINI_KEY') )

#intences:
chunk = Chunky()
chroma = chromadb.PersistentClient('./context-storage')
collection = chroma.get_or_create_collection('contexts')

def gemini_encodding(text:str):

    responce = ai_client.models.embed_content(
        model="gemini-embedding-2",
        contents= text
    )

    results = responce.embedding
    vector = results[0].values

    return vector

def store(para:str, chunk_size:int, overlap:int):

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

def result(user_request:str, ktop:int =2):

    request_vector = gemini_encodding(user_request)

    results = collection.query(
        query_embeddings=request_vector,
        n_results=ktop
    )

    a= results['documents'][0]
    return a