/**
 * MovieActor Web Client
 */

const STORAGE_KEY = "movieactor_game_id"

// DOM elements
const chat = document.getElementById("chat")
const statusEl = document.getElementById("status")
const inputForm = document.getElementById("input-form")
const input = document.getElementById("input")
const submitBtn = document.getElementById("submit")
const voiceCheckbox = document.getElementById("tts-checkbox")
const restartBtn = document.getElementById("restart-btn")

// State
let gameId = null
let socket = null
let voiceEnabled = false
let recognition = null
let micReady = false
let listeningIndicator = null

// Set up speech recognition if available
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
let gotResult = false

if (SpeechRecognition) {
    recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = "en-US"

    recognition.onstart = () => {
        gotResult = false
        showListeningIndicator()
    }

    recognition.onresult = (event) => {
        gotResult = true
        hideListeningIndicator()
        const text = event.results[0][0].transcript.trim()
        if (text && gameId) {
            addMessage(text, "user")
            socket.emit("input", { gameId, text })
            scrollToBottom()
        }
    }

    recognition.onerror = (event) => {
        // "no-speech" and "aborted" are expected when user is quiet
        if (event.error !== "no-speech" && event.error !== "aborted") {
            console.log("Speech recognition error:", event.error)
        }
    }

    recognition.onend = () => {
        // If voice is still enabled and we didn't get a result, restart listening
        if (voiceEnabled && micReady && !gotResult) {
            setTimeout(() => {
                if (voiceEnabled && micReady) {
                    try {
                        recognition.start()
                    } catch (_e) {
                        // Ignore - may already be running
                    }
                }
            }, 100)
        }
    }
}

async function enableVoice() {
    if (!recognition) {
        alert("Speech recognition is not supported in this browser.")
        voiceCheckbox.checked = false
        return false
    }

    try {
        // Request microphone access
        await navigator.mediaDevices.getUserMedia({ audio: true })
        voiceEnabled = true
        micReady = true
        voiceCheckbox.checked = true

        // Speak the most recent system message
        const messages = chat.querySelectorAll(".message.system")
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1]
            speak(lastMessage.innerText)
        }

        return true
    } catch (err) {
        console.error("Microphone access denied:", err)
        alert("Microphone access is required for voice mode.")
        voiceCheckbox.checked = false
        return false
    }
}

function disableVoice() {
    voiceEnabled = false
    micReady = false
    voiceCheckbox.checked = false
    hideListeningIndicator()
    if (recognition) {
        recognition.abort()
    }
    window.speechSynthesis.cancel()
}

voiceCheckbox.addEventListener("change", async () => {
    if (voiceCheckbox.checked) {
        await enableVoice()
    } else {
        disableVoice()
    }
})

restartBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY)
    clearChat()
    socket.emit("new-game")
})

// Initialize
function init() {
    socket = io()

    socket.on("connect", () => {
        console.log("Connected to server")

        // Check for existing game in localStorage
        const savedGameId = localStorage.getItem(STORAGE_KEY)
        if (savedGameId) {
            socket.emit("rejoin-game", savedGameId)
        } else {
            socket.emit("new-game")
        }
    })

    socket.on("disconnect", () => {
        console.log("Disconnected from server")
        setInputEnabled(false)
    })

    socket.on("game-created", (data) => {
        gameId = data.gameId
        localStorage.setItem(STORAGE_KEY, gameId)
        clearChat()
        setInputEnabled(true)
        console.log("Game created:", gameId)
    })

    socket.on("reconnected", (data) => {
        gameId = data.gameId
        setInputEnabled(true)
        console.log("Reconnected to game:", gameId)
    })

    socket.on("new-game-required", () => {
        localStorage.removeItem(STORAGE_KEY)
        socket.emit("new-game")
    })

    socket.on("output", (data) => {
        addMessage(data.output, "system")
        updateStatus(data.state)
        setInputEnabled(true)
        scrollToBottom()
        speak(data.output)
    })

    socket.on("error", (data) => {
        addMessage(`Error: ${data.message}`, "system")
    })

    // Handle form submission
    inputForm.addEventListener("submit", (e) => {
        e.preventDefault()
        const text = input.value.trim()
        if (!text || !gameId) return

        addMessage(text, "user")
        socket.emit("input", { gameId, text })
        input.value = ""
        scrollToBottom()
    })

    // Focus input on load
    input.focus()
}

function clearChat() {
    chat.innerHTML = ""
}

function addMessage(text, type) {
    const msg = document.createElement("div")
    msg.className = `message ${type}`
    if (type === "system") {
        // System messages may contain HTML (bold movie/actor names)
        msg.innerHTML = text.replace(/\n/g, "<br>")
    } else {
        msg.textContent = text
    }
    chat.appendChild(msg)
}

function showListeningIndicator() {
    if (listeningIndicator) return
    listeningIndicator = document.createElement("div")
    listeningIndicator.className = "message listening"
    listeningIndicator.textContent = "Listening..."
    chat.appendChild(listeningIndicator)
    scrollToBottom()
}

function hideListeningIndicator() {
    if (listeningIndicator) {
        listeningIndicator.remove()
        listeningIndicator = null
    }
}

function updateStatus(state) {
    if (!state) {
        statusEl.querySelector(".current-item").textContent = ""
        statusEl.querySelector(".scores").textContent = ""
        return
    }

    const currentItemEl = statusEl.querySelector(".current-item")
    const scoresEl = statusEl.querySelector(".scores")

    if (state.currentItem && state.phase === "playing") {
        const itemName = state.currentItem.name
        const year = state.currentItem.year ? ` (${state.currentItem.year})` : ""
        const type = state.currentItemType === "movie" ? "Movie" : "Actor"
        currentItemEl.textContent = `${type}: ${itemName}${year}`
    } else {
        currentItemEl.textContent = ""
    }

    if (state.scores) {
        scoresEl.textContent = `You ${state.scores.human} - Computer ${state.scores.computer}`
    } else {
        scoresEl.textContent = ""
    }
}

function setInputEnabled(enabled) {
    input.disabled = !enabled
    submitBtn.disabled = !enabled
    if (enabled) {
        input.focus()
    }
}

function scrollToBottom() {
    chat.scrollTop = chat.scrollHeight
}

function prepareTextForSpeech(text) {
    // Strip HTML tags
    const stripped = text.replace(/<[^>]*>/g, "")
    // Replace multiple newlines with a longer pause (ellipsis)
    // Replace single newlines with a short pause (comma)
    return stripped.replace(/\n\n+/g, "... ").replace(/\n/g, ", ").replace(/\s+/g, " ").trim()
}

function speak(text, retries = 3) {
    if (!voiceEnabled || !window.speechSynthesis) return

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    const spokenText = prepareTextForSpeech(text)
    const utterance = new SpeechSynthesisUtterance(spokenText)
    utterance.rate = 1.0
    utterance.pitch = 1.0

    // Handle errors with retry
    utterance.onerror = (event) => {
        console.log("TTS error:", event.error)
        if (retries > 0) {
            console.log(`Retrying TTS... (${retries} attempts left)`)
            setTimeout(() => speak(text, retries - 1), 200)
        } else {
            // All retries exhausted, still start listening
            startListening()
        }
    }

    // When speech ends, start listening
    utterance.onend = () => {
        startListening()
    }

    window.speechSynthesis.speak(utterance)

    // Workaround for Chrome bug where long text can cause TTS to stop
    // Keep speechSynthesis alive by resuming periodically
    const keepAlive = setInterval(() => {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.pause()
            window.speechSynthesis.resume()
        } else {
            clearInterval(keepAlive)
        }
    }, 10000)
}

function startListening() {
    if (voiceEnabled && micReady && recognition) {
        try {
            recognition.start()
        } catch (_e) {
            // Recognition may already be running
        }
    }
}

// Start
init()
