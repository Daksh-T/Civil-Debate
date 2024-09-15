document.addEventListener("DOMContentLoaded", () => {
    // **DOM Elements**
    const nameEntryModal = document.getElementById("name-entry");
    const saveNameBtn = document.getElementById("save-name");
    const usernameInput = document.getElementById("username");
    const mainContent = document.getElementById("main-content");
    const topicsList = document.getElementById("topics-list");
    const createTopicBtn = document.getElementById("create-topic");
    const newTopicInput = document.getElementById("new-topic");
    const debateSection = document.getElementById("debate-section");
    const debateTitle = document.getElementById("debate-title");
    const debateActions = document.getElementById("debate-actions");
    const leaveDebateBtn = document.getElementById("leave-debate");
    const downloadChatBtn = document.getElementById("download-chat");
    const forButton = document.getElementById("for-button");
    const againstButton = document.getElementById("against-button");
    const chooseSideSection = document.getElementById("choose-side");
    const chatSection = document.getElementById("chat-section");
    const chatBox = document.getElementById("chat-box");
    const chatInput = document.getElementById("chat-input");
    const sendChatBtn = document.getElementById("send-chat");
    const forUsersList = document.getElementById("for-users");
    const againstUsersList = document.getElementById("against-users");
    const themeToggleBtn = document.getElementById("theme-toggle");
    const headerTitle = document.querySelector("header h1");

    // **State Variables**
    let username = localStorage.getItem("username") || "";
    let currentTopic = null;
    let side = null;
    let socket = null;
    let creator = false;

    initializeTheme();

    // **Show or Hide Name Entry Modal**
    if (username) {
        nameEntryModal.style.display = "none";
        mainContent.style.display = "flex";
        loadTopics();
    } else {
        nameEntryModal.style.display = "flex";
    }

    // **Event Listener: Save Username**
    saveNameBtn.addEventListener("click", () => {
        const name = usernameInput.value.trim();
        if (name) {
            username = name;
            localStorage.setItem("username", username);
            nameEntryModal.style.display = "none";
            mainContent.style.display = "flex";
            loadTopics();
        } else {
            alert("Please enter a valid name.");
        }
    });

    // **Event Listener: Create New Topic**
    createTopicBtn.addEventListener("click", async () => {
        const title = newTopicInput.value.trim();
        if (title) {
            try {
                const response = await fetch("/api/topics", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ title, username })
                });
                const data = await response.json();
                if (response.ok && data.id) {
                    addTopicToList(data);
                    newTopicInput.value = "";
                    await selectTopic(data.id);
                } else {
                    alert(data.detail || "Error creating topic.");
                }
            } catch (error) {
                console.error("Error creating topic:", error);
                alert("Error creating topic.");
            }
        } else {
            alert("Topic title cannot be empty.");
        }
    });

    // **Function: Load Topics from Backend**
    async function loadTopics() {
        try {
            const response = await fetch("/api/topics");
            if (response.ok) {
                const topics = await response.json();
                topicsList.innerHTML = "";
                topics.forEach(addTopicToList);
            } else {
                console.error("Failed to load topics.");
            }
        } catch (error) {
            console.error("Error fetching topics:", error);
        }
    }

    // **Function: Add Topic to List**
    function addTopicToList(topic) {
        const li = document.createElement("li");
        li.textContent = topic.title;
        li.dataset.id = topic.id;
        const actionsDiv = document.createElement("div");
        const deleteBtn = document.createElement("button");
        deleteBtn.innerHTML = `<i class="fas fa-trash"></i>`;
        deleteBtn.classList.add("delete-btn");
        if (topic.creator === username) {
            deleteBtn.style.display = "flex";
            deleteBtn.title = "Delete Debate";
            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation(); // Prevent triggering the join
                deleteDebate(topic.id);
            });
        } else {
            deleteBtn.style.display = "none";
        }
        actionsDiv.appendChild(deleteBtn);
        li.appendChild(actionsDiv);
        li.addEventListener("click", async () => {
            await selectTopic(topic.id);
        });
        topicsList.appendChild(li);
    }

    // **Function: Select and Join a Topic**
    async function selectTopic(topic_id) {
        try {
            const response = await fetch(`/api/topics/${topic_id}`);
            if (!response.ok) {
                alert("Failed to fetch topic details.");
                return;
            }
            const topic = await response.json();
            currentTopic = topic;
            creator = (topic.creator === username);
            if (topic.for.includes(username)) {
                side = "for";
            } else if (topic.against.includes(username)) {
                side = "against";
            } else {
                side = null;
            }
            updateDebateActions();
            updateUserLists(currentTopic);
            debateTitle.textContent = topic.title;
            debateSection.style.display = "flex";
            document.getElementById("topics-section").style.display = "none";
            // **Show or Hide Choose Side and Chat Sections Based on Participation**
            if (!side) {
                // **User is not part of any side**
                chooseSideSection.style.display = "block";
                chatSection.style.display = "none";
            } else {
                // **User is already part of a side**
                chooseSideSection.style.display = "none";
                chatSection.style.display = "flex";
                initializeWebSocket();
            }
        } catch (error) {
            console.error("Error selecting topic:", error);
            alert("Error selecting topic.");
        }
    }

    // **Function: Update Debate Actions (Leave and Download Buttons)**
    function updateDebateActions() {
        if (currentTopic) {
            if (creator) {
                leaveDebateBtn.style.display = "flex";
                leaveDebateBtn.disabled = true;
                leaveDebateBtn.innerHTML = `<i class="fas fa-lock"></i>`; // Lock icon
                leaveDebateBtn.title = "You cannot leave as the creator. To end the debate, delete it.";
                downloadChatBtn.style.display = "flex";
            } else {
                if (side === "for" || side === "against") {
                    leaveDebateBtn.style.display = "flex";
                    leaveDebateBtn.disabled = false;
                    leaveDebateBtn.innerHTML = `<i class="fas fa-sign-out-alt"></i>`;
                    leaveDebateBtn.title = "Leave Debate";
                    downloadChatBtn.style.display = "flex";
                } else {
                    // **User Not Joined Yet**
                    leaveDebateBtn.style.display = "none";
                    downloadChatBtn.style.display = "none";
                }
            }
        }
    }

    // **Function: Delete a Debate (Only Creator)**
    async function deleteDebate(topic_id) {
        if (confirm("Are you sure you want to delete this debate?")) {
            try {
                const response = await fetch(`/api/topics/${topic_id}/delete`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username })
                });
                const data = await response.json();
                if (response.ok) {
                    alert(data.message);
                    loadTopics();
                    resetDebateSection();
                } else {
                    alert(data.detail || "Error deleting debate.");
                }
            } catch (error) {
                console.error("Error deleting debate:", error);
                alert("Error deleting debate.");
            }
        }
    }

    // **Event Listener: Leave Debate**
    leaveDebateBtn.addEventListener("click", async () => {
        if (creator) {
            alert("As the creator of this debate, you cannot leave. If you wish to end the debate, you can delete it from the topics list.");
            return;
        }
        if (confirm("Are you sure you want to leave this debate?")) {
            try {
                const response = await fetch(`/api/topics/${currentTopic.id}/leave`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username })
                });
                const data = await response.json();
                if (response.ok) {
                    alert(data.message);
                    leaveDebate();
                } else {
                    alert(data.detail || "Error leaving debate.");
                }
            } catch (error) {
                console.error("Error leaving debate:", error);
                alert("Error leaving debate.");
            }
        }
    });

    // **Function: Handle Leaving a Debate**
    function leaveDebate() {
        if (socket) {
            socket.close();
            socket = null;
        }
        removeUserFromLists(username);
        chatSection.style.display = "none";
        chooseSideSection.style.display = "block";
        updateDebateActions();
        side = null;
    }

    // **Function: Initialize WebSocket for Real-Time Chat**
    async function initializeWebSocket() {
        if (socket) {
            socket.close();
            socket = null;
        }
        // **Determine Protocol Based on Current Page**
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        socket = new WebSocket(`${protocol}://${window.location.host}/ws/${currentTopic.id}?username=${encodeURIComponent(username)}`);
        socket.onopen = () => {
        };
        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            displayMessage(data);
            // **Handle System Messages (e.g., Debate Paused)**
            if (data.username === "System" && data.message.includes("paused")) {
                chatSection.style.display = "none";
                chooseSideSection.style.display = "block";
                alert(data.message);
            }
            // **Auto-Scroll to Latest Message**
            scrollToBottom();
        };
        socket.onclose = () => {
        };
        socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };
    }

    // **Event Listener: Send Chat Message**
    sendChatBtn.addEventListener("click", sendMessage);
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });

    // **Function: Send Message via WebSocket**
    async function sendMessage() {
        const message = chatInput.value.trim();
        if (message && socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({
                    username,
                    side,
                    message
                }));
                chatInput.value = "";
                scrollToBottom();
            } catch (error) {
                console.error("Error sending message:", error);
                alert("Error sending message.");
            }
        }
    }

    // **Function: Display Received Message in Chat Box**
    function displayMessage(data) {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message");
        const usernameSpan = document.createElement("span");
        usernameSpan.classList.add("username");
        usernameSpan.textContent = data.username;
        usernameSpan.classList.add(data.username === "System" ? "system" : "user");
        const textSpan = document.createElement("span");
        textSpan.classList.add("text");
        textSpan.textContent = ` ${data.message}`;
        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(textSpan);
        chatBox.appendChild(messageDiv);
        // **Handle System Messages (e.g., Debate Paused)**
        if (data.username === "System" && data.message.includes("paused")) {
            chooseSideSection.style.display = "block";
            chatSection.style.display = "none";
        }
        scrollToBottom();
    }

    // **Function: Scroll Chat Box to Bottom**
    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // **Function: Update User Lists in UI**
    function updateUserLists(topic) {
        forUsersList.innerHTML = "";
        againstUsersList.innerHTML = "";
        topic.for.forEach(user => {
            const li = document.createElement("li");
            li.textContent = user;
            forUsersList.appendChild(li);
        });
        topic.against.forEach(user => {
            const li = document.createElement("li");
            li.textContent = user;
            againstUsersList.appendChild(li);
        });
    }

    // **Function: Remove User from User Lists in UI**
    function removeUserFromLists(user) {
        const forItems = forUsersList.getElementsByTagName("li");
        for (let i = forItems.length - 1; i >= 0; i--) {
            if (forItems[i].textContent === user) {
                forUsersList.removeChild(forItems[i]);
            }
        }
        const againstItems = againstUsersList.getElementsByTagName("li");
        for (let i = againstItems.length - 1; i >= 0; i--) {
            if (againstItems[i].textContent === user) {
                againstUsersList.removeChild(againstItems[i]);
            }
        }
    }

    // **Function: Reset Debate Section UI**
    async function resetDebateSection() {
        debateSection.style.display = "none";
        debateTitle.textContent = "";
        debateActions.style.display = "none";
        forUsersList.innerHTML = "";
        againstUsersList.innerHTML = "";
        chatBox.innerHTML = "";
        chatSection.style.display = "none";
        chooseSideSection.style.display = "none";
        document.getElementById("topics-section").style.display = "flex";
        if (socket) {
            socket.close();
            socket = null;
        }
        currentTopic = null;
        side = null;
        creator = false; // **Ensure creator flag is reset**
    }

    // **Event Listener: Header Click to Refresh the Page**
    headerTitle.addEventListener("click", () => {
        window.location.reload();
    });

    // **Event Listeners: Join Debate Side**
    forButton.addEventListener("click", () => joinTopic("for"));
    againstButton.addEventListener("click", () => joinTopic("against"));

    // **Function: Join a Debate Side (For/Against)**
    async function joinTopic(selectedSide) {
        if (!currentTopic) {
            alert("No topic selected.");
            return;
        }
        try {
            const response = await fetch(`/api/topics/${currentTopic.id}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ side: selectedSide, username })
            });
            const data = await response.json();
            if (response.ok) {
                if (selectedSide === "for") {
                    currentTopic.for.push(username);
                    const li = document.createElement("li");
                    li.textContent = username;
                    forUsersList.appendChild(li);
                } else if (selectedSide === "against") {
                    currentTopic.against.push(username);
                    const li = document.createElement("li");
                    li.textContent = username;
                    againstUsersList.appendChild(li);
                }
                side = selectedSide;
                chooseSideSection.style.display = "none";
                chatSection.style.display = "flex";
                updateDebateActions();
                initializeWebSocket();
                alert(data.message || `You have joined the debate as "${selectedSide}".`);
            } else {
                alert(data.detail || "Error joining the debate.");
            }
        } catch (error) {
            console.error("Error joining debate:", error);
            alert("Error joining the debate.");
        }
    }

    // **Function: Initialize Dark Mode and Theme Toggle**
    function initializeTheme() {
        const savedTheme = localStorage.getItem("theme") || "light";
        applyTheme(savedTheme);
        themeToggleBtn.addEventListener("click", () => {
            const currentTheme = document.body.classList.contains("dark") ? "dark" : "light";
            const newTheme = currentTheme === "dark" ? "light" : "dark";
            applyTheme(newTheme);
        });
    }

    // **Function: Apply Selected Theme (Light/Dark)**
    function applyTheme(theme) {
        if (theme === "dark") {
            document.body.classList.add("dark");
            themeToggleBtn.innerHTML = `<i class="fas fa-sun"></i>`;
            localStorage.setItem("theme", "dark");
        } else {
            document.body.classList.remove("dark");
            themeToggleBtn.innerHTML = `<i class="fas fa-moon"></i>`;
            localStorage.setItem("theme", "light");
        }
    }

    // **Event Listener: Download Conversation History**
    downloadChatBtn.addEventListener("click", downloadConversation);

    // **Function: Download Conversation as .txt File**
    function downloadConversation() {
        if (!currentTopic) {
            alert("No active debate to download.");
            return;
        }
        const messages = document.querySelectorAll("#chat-box .message");
        let conversation = `Debate Conversation\n\n`;
        conversation += `Debate Title: ${currentTopic.title}\n\n`;
        conversation += `Participants:\n`;
        conversation += `For (${currentTopic.for.length}): ${currentTopic.for.join(", ")}\n`;
        conversation += `Against (${currentTopic.against.length}): ${currentTopic.against.join(", ")}\n\n`;
        conversation += `Conversation:\n`;
        messages.forEach(msg => {
            const username = msg.querySelector(".username").textContent;
            const message = msg.querySelector(".text").textContent;
            conversation += `${username}: ${message}\n`;
        });
        const blob = new Blob([conversation], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `debate_${currentTopic.id}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});
