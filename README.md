# Civil Debate

A debating platform that lets users engage in good faith debate with the help of AI

## Why build this?

Healthy debate is an important part of society. Yet, in the recent years (especially due to the rise of social media) good faith debate has become rarer. Online debates often descend to vulgarities and personal attacks. 

Civil Debate was built to help people have impactful debates, using LLMs as a layer between the debaters so the debate is respectful and beneficial to both sides.

## How does it work?
Civil Debate uses **Llama 3.1 70B** to serve as a civility layer: it rephrases arguments to be more respectful and filters messages that contain insults or personal attacks.

## Setup
1. Clone the repo
2. Set GROQ_API_KEY environment variable
* `export GROQ_API_KEY='your-api-key'` on Unix/macOS
* `$env:GROQ_API_KEY = 'your-api-key'` on Windows (PowerShell)
3. Navigate to backend directory by running `cd backend`
4. Install requirements by running `pip install -r requirements.txt`
5. Run the app using `uvicorn main:app --reload`
6. Open your browser and visit `http://localhost:8000`

## Usage

**Creating a Debate:**
* Click on "Create Debate" and enter a topic.

**Joining a Debate:**
* Select a debate from the list.
* Choose a side: For or Against.

**Participating:**
* Engage in the chat. Your messages will be moderated by the AI before being sent.

**Downloading Transcripts:**
* Click on the "Download" button to save the debate transcript.

## Contributing
Contributions are welcome! Feel free to submit a pull request.