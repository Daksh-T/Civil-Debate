import os
import uuid
import asyncio
from typing import List, Dict

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from groq import Groq
from fastapi.middleware.cors import CORSMiddleware
from urllib.parse import parse_qs

from sqlalchemy import (
    create_engine, Column, String, Integer, Text, ForeignKey
)
from sqlalchemy.orm import sessionmaker, relationship, declarative_base, Session

app = FastAPI()

app.mount("/static", StaticFiles(directory="../frontend"), name="static")

DATABASE_URL = "sqlite:///./debate.db"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Database Models
class Topic(Base):
    __tablename__ = "topics"

    id = Column(String, primary_key=True, index=True)
    title = Column(String, nullable=False)
    creator = Column(String, nullable=False)
    participants = relationship("Participant", back_populates="topic", cascade="all, delete")
    messages = relationship("Message", back_populates="topic", cascade="all, delete")


class Participant(Base):
    __tablename__ = "participants"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(String, ForeignKey("topics.id"), nullable=False)
    username = Column(String, nullable=False)
    side = Column(String, nullable=False)  # "for" or "against"

    topic = relationship("Topic", back_populates="participants")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    topic_id = Column(String, ForeignKey("topics.id"), nullable=False)
    username = Column(String, nullable=False)
    message = Column(Text, nullable=False)

    topic = relationship("Topic", back_populates="messages")

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

clients: Dict[str, Dict[str, WebSocket]] = {}  # topic_id: {username: WebSocket}

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable not set.")

groq_client = Groq(api_key=GROQ_API_KEY)

# Pydantic Models
class TopicCreate(BaseModel):
    title: str
    username: str

class JoinTopic(BaseModel):
    side: str
    username: str

class DeleteTopic(BaseModel):
    username: str

class LeaveTopic(BaseModel):
    username: str

def generate_topic_id() -> str:
    return str(uuid.uuid4())

@app.get("/", response_class=HTMLResponse)
async def get():
    try:
        with open("../frontend/index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read(), status_code=200)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Index file not found.")

@app.get("/api/topics")
async def get_topics(db: Session = Depends(get_db)):
    topics = db.query(Topic).all()
    response = []
    for topic in topics:
        for_users = [p.username for p in topic.participants if p.side == "for"]
        against_users = [p.username for p in topic.participants if p.side == "against"]
        response.append({
            "id": topic.id,
            "title": topic.title,
            "creator": topic.creator,
            "for": for_users,
            "against": against_users
        })
    return response

@app.get("/api/topics/{topic_id}")
async def get_topic(topic_id: str, db: Session = Depends(get_db)):
    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found.")
    for_users = [p.username for p in topic.participants if p.side == "for"]
    against_users = [p.username for p in topic.participants if p.side == "against"]
    return {
        "id": topic.id,
        "title": topic.title,
        "creator": topic.creator,
        "for": for_users,
        "against": against_users
    }

@app.post("/api/topics")
async def create_topic(topic: TopicCreate, db: Session = Depends(get_db)):
    topic_id = generate_topic_id()
    db_topic = Topic(id=topic_id, title=topic.title, creator=topic.username)
    db.add(db_topic)
    db.commit()
    db.refresh(db_topic)
    return {
        "id": topic_id,
        "title": topic.title,
        "creator": topic.username,
        "for": [],
        "against": []
    }

@app.post("/api/topics/{topic_id}/join")
async def join_topic(topic_id: str, join: JoinTopic, db: Session = Depends(get_db)):
    if join.side not in ["for", "against"]:
        raise HTTPException(status_code=400, detail="Invalid side. Choose 'for' or 'against'.")
    
    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found.")
    
    existing_participant = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.username == join.username
    ).first()
    if existing_participant:
        if existing_participant.side != join.side:
            existing_participant.side = join.side
            db.commit()
    else:
        participant = Participant(
            topic_id=topic_id,
            username=join.username,
            side=join.side
        )
        db.add(participant)
        db.commit()
    
    # Check if at least one user is on both sides
    for_count = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.side == "for"
    ).count()
    against_count = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.side == "against"
    ).count()
    
    if for_count >= 1 and against_count >= 1:
        return {"message": f"{join.username} joined {join.side}. Debate can begin."}
    else:
        return {"message": f"{join.username} joined {join.side}. Waiting for participants on the other side."}

@app.post("/api/topics/{topic_id}/delete")
async def delete_topic(topic_id: str, delete: DeleteTopic, db: Session = Depends(get_db)):
    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found.")
    if delete.username != topic.creator:
        raise HTTPException(status_code=403, detail="Only the creator can delete this debate.")
    
    if topic_id in clients:
        websockets_to_close = list(clients[topic_id].values())
        for user_ws in websockets_to_close:
            await user_ws.close()
        del clients[topic_id]
    
    db.delete(topic)
    db.commit()
    return {"message": "Debate topic deleted successfully."}

@app.post("/api/topics/{topic_id}/leave")
async def leave_topic(topic_id: str, leave: LeaveTopic, db: Session = Depends(get_db)):
    topic = db.query(Topic).filter(Topic.id == topic_id).first()
    if not topic:
        raise HTTPException(status_code=404, detail="Topic not found.")
    
    participant = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.username == leave.username
    ).first()
    
    if not participant:
        raise HTTPException(status_code=400, detail="User not part of this debate.")
    
    db.delete(participant)
    db.commit()
    
    # Check if the debate should be paused
    for_count = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.side == "for"
    ).count()
    against_count = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.side == "against"
    ).count()
    
    if for_count < 1 or against_count < 1:
        pause_message = {
            "username": "System",
            "message": "Debate is paused. Waiting for participants on the opposing side."
        }
        await broadcast(topic_id, pause_message)
    
    return {"message": "You have left the debate."}

@app.websocket("/ws/{topic_id}")
async def websocket_endpoint(websocket: WebSocket, topic_id: str, db: Session = Depends(get_db)):
    await websocket.accept()
    
    query_params = parse_qs(websocket.scope["query_string"].decode())
    username = query_params.get("username")
    
    if not username:
        await websocket.close(code=1008)
        return
    
    username = username[0]  # parse_qs returns a list for each key
    
    if topic_id not in clients:
        clients[topic_id] = {}
    
    # Associate the username with the WebSocket
    clients[topic_id][username] = websocket
    
    try:
        messages = db.query(Message).filter(Message.topic_id == topic_id).all()
        participants = db.query(Participant).filter(Participant.topic_id == topic_id).all()
        user_side_map = {participant.username: participant.side for participant in participants}
        
        for msg in messages:
            side_of_sender = user_side_map.get(msg.username, "Unknown").capitalize()
            formatted_message = f"{msg.username} ({side_of_sender}): {msg.message}"
            await websocket.send_json({
                "username": msg.username,
                "message": msg.message
            })
        
        while True:
            data = await websocket.receive_json()
            username_msg = data.get("username")
            side = data.get("side")
            message = data.get("message")

            if not username_msg or not side or not message:
                error_response = {"username": "System", "message": "Invalid message format."}
                await websocket.send_json(error_response)
                continue

            asyncio.create_task(process_message(topic_id, username_msg, side, message, db))

    except WebSocketDisconnect:
        if topic_id in clients and username in clients[topic_id]:
            del clients[topic_id][username]
            if not clients[topic_id]:
                del clients[topic_id]

async def process_message(topic_id: str, username: str, side: str, message: str, db: Session):
    # Ensure debate has participants on both sides
    for_count = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.side == "for"
    ).count()
    against_count = db.query(Participant).filter(
        Participant.topic_id == topic_id,
        Participant.side == "against"
    ).count()
    
    if for_count < 1 or against_count < 1:
        error_message = {
            "username": "System",
            "message": "Debate cannot proceed until there are participants on both sides."
        }
        await send_private_message(topic_id, username, error_message)
        return

    # Send the message to Groq API in a separate thread to prevent blocking
    try:
        moderated_message = await asyncio.to_thread(
            moderate_message_with_groq, topic_id, db, topic_title=db.query(Topic).filter(Topic.id == topic_id).first().title, side=side, message=message, username=username
        )
    except Exception as e:
        error_message = {
            "username": "System",
            "message": f"An error occurred while processing your message: {str(e)}"
        }
        await send_private_message(topic_id, username, error_message)
        return

    if moderated_message:
        db_message = Message(
            topic_id=topic_id,
            username=username,
            message=moderated_message
        )
        db.add(db_message)
        db.commit()
        
        broadcast_message = {
            "username": username,
            "message": moderated_message
        }
        await broadcast(topic_id, broadcast_message)
    else:
        error_message = {
            "username": "System",
            "message": "Your message contains only personal attacks or hate speech. Please adhere to respectful discourse."
        }
        await send_private_message(topic_id, username, error_message)

def moderate_message_with_groq(topic_id: str, db: Session, topic_title: str, side: str, message: str, username: str) -> str:
    """
    Sends the user's message along with the debate topic and the user's side to the Groq API for moderation.
    Returns the moderated message if points are found.
    Returns 'Invalid' if only hostility is detected.
    """
    # Retrieve the last two messages or all available if fewer
    messages = db.query(Message).filter(Message.topic_id == topic_id).order_by(Message.id.desc()).limit(2).all()
    
    participants = db.query(Participant).filter(Participant.topic_id == topic_id).all()
    user_side_map = {participant.username: participant.side for participant in participants}
    
    previous_messages = "\n".join([
        f"{msg.username} ({user_side_map.get(msg.username, 'Unknown').capitalize()}): {msg.message}" 
        for msg in reversed(messages)
    ])
    
    author_side = user_side_map.get(username, "Unknown").capitalize()
    
    prompt = (
        f"Debate Topic: {topic_title}\n\n"
        f"Debate Chat History:\n"
        f"{previous_messages}\n\n"
        f"Respond with a polite and civil summary of the arguments made by the message below. "
        f"Make sure it is in line with the message author's position, no matter how controversial. "
        f"DO NOT begin your message with any other content, just rephrase the message in a polite and civil way but without losing the intensity and surety that the author intended in the message. "
        f"Don't use any markdown formatting - just plain text. Respond as if you're the one writing the message (so response must be in first person and conversational). Keep it concise but don't skip any points or make up new points. "
        f"If the message is not supporting the side that the user is on, summarize it anyway.\n\n"
        f"If the message contains only personal attacks or hate speech without any substantive points, respond with 'Invalid'\n\n"
        f"Message Author: {username}\n"
        f"Message Author's Position: {author_side}\n\n"
        f"Message: {message}"
    )
    
    chat_completion = groq_client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        model="llama-3.1-70b-versatile",
    )
    
    response_content = chat_completion.choices[0].message.content.strip()
    
    if response_content.lower() == "invalid" or response_content.lower() == "invalid.":
        return ""
    elif response_content:
        return response_content
    else:
        return ""

async def broadcast(topic_id: str, message: Dict):
    """
    Broadcasts a message to all clients within a topic.
    """
    if topic_id in clients:
        for client_ws in clients[topic_id].values():
            try:
                await client_ws.send_json(message)
            except Exception as e:
                print(f"Error broadcasting message to a client: {e}")

async def send_private_message(topic_id: str, username: str, message: Dict):
    """
    Sends a private message to a specific user within a topic.
    """
    if topic_id in clients and username in clients[topic_id]:
        try:
            await clients[topic_id][username].send_json(message)
        except Exception as e:
            print(f"Error sending private message to {username}: {e}")
    else:
        print(f"User {username} not found in topic {topic_id}.")
