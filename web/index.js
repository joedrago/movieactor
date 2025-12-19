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
            hideListeningIndicator()
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
    console.log("[Voice] enableVoice() called")
    console.log("[Voice] recognition available:", !!recognition)
    console.log("[Voice] speechSynthesis available:", !!window.speechSynthesis)

    if (!recognition) {
        console.log("[Voice] Aborting: no recognition support")
        alert("Speech recognition is not supported in this browser.")
        voiceCheckbox.checked = false
        return false
    }

    // iOS Safari requires speechSynthesis to be triggered directly from user gesture.
    // The await below breaks the gesture chain, so we "unlock" TTS first with an empty utterance.
    if (window.speechSynthesis) {
        console.log("[Voice] Unlocking speechSynthesis with empty utterance (iOS workaround)")
        const unlock = new SpeechSynthesisUtterance("")
        window.speechSynthesis.speak(unlock)
    }

    try {
        // Request microphone access
        console.log("[Voice] Requesting microphone access...")
        await navigator.mediaDevices.getUserMedia({ audio: true })
        console.log("[Voice] Microphone access granted")

        voiceEnabled = true
        micReady = true
        voiceCheckbox.checked = true
        console.log("[Voice] voiceEnabled:", voiceEnabled, "micReady:", micReady)

        // Speak the most recent system message
        const messages = chat.querySelectorAll(".message.system")
        console.log("[Voice] Found", messages.length, "system messages")
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1]
            console.log("[Voice] Speaking last message:", lastMessage.innerText.substring(0, 50) + "...")
            speak(lastMessage.innerText)
        }

        return true
    } catch (err) {
        console.error("[Voice] Microphone access denied:", err)
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
        try {
            hideListeningIndicator()
            addMessage(data.output, "system")
            updateStatus(data.state)
            scrollToBottom()
            speak(data.output)
        } catch (err) {
            console.error("Error handling output:", err)
            addMessage("Error displaying response", "system")
        } finally {
            setInputEnabled(true)
        }
    })

    socket.on("error", (data) => {
        hideListeningIndicator()
        addMessage(`Error: ${data.message}`, "system")
        setInputEnabled(true)
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
    console.log("[TTS] speak() called")
    console.log("[TTS] voiceEnabled:", voiceEnabled)
    console.log("[TTS] speechSynthesis available:", !!window.speechSynthesis)
    console.log("[TTS] retries remaining:", retries)

    if (!voiceEnabled) {
        console.log("[TTS] Aborting: voice not enabled")
        return
    }
    if (!window.speechSynthesis) {
        console.log("[TTS] Aborting: speechSynthesis not available")
        return
    }

    // Check voices
    const voices = window.speechSynthesis.getVoices()
    console.log("[TTS] Available voices:", voices.length)
    voices.forEach((v, i) => {
        if (i < 5) console.log(`[TTS]   Voice ${i}: ${v.name} (${v.lang}) default=${v.default}`)
    })
    if (voices.length > 5) console.log(`[TTS]   ... and ${voices.length - 5} more`)

    // Check current state
    console.log(
        "[TTS] Current state - speaking:",
        window.speechSynthesis.speaking,
        "pending:",
        window.speechSynthesis.pending,
        "paused:",
        window.speechSynthesis.paused
    )

    // Cancel any ongoing speech
    console.log("[TTS] Calling cancel()")
    window.speechSynthesis.cancel()

    const spokenText = prepareTextForSpeech(text)
    console.log("[TTS] Text to speak:", spokenText.substring(0, 100) + (spokenText.length > 100 ? "..." : ""))

    const utterance = new SpeechSynthesisUtterance(spokenText)
    utterance.rate = 1.0
    utterance.pitch = 1.0
    console.log("[TTS] Created utterance, rate:", utterance.rate, "pitch:", utterance.pitch)

    // Detect iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    console.log("[TTS] iOS detected:", isIOS)

    utterance.onstart = () => {
        console.log("[TTS] EVENT: onstart - speech began")
    }

    utterance.onpause = () => {
        console.log("[TTS] EVENT: onpause - speech paused")
    }

    utterance.onresume = () => {
        console.log("[TTS] EVENT: onresume - speech resumed")
    }

    utterance.onboundary = (event) => {
        console.log("[TTS] EVENT: onboundary - type:", event.name, "charIndex:", event.charIndex)
    }

    // Handle errors with retry
    utterance.onerror = (event) => {
        console.log("[TTS] EVENT: onerror")
        console.log("[TTS] Error type:", event.error)
        console.log("[TTS] Error event:", event)
        if (retries > 0) {
            console.log(`[TTS] Retrying... (${retries} attempts left)`)
            setTimeout(() => speak(text, retries - 1), 200)
        } else {
            console.log("[TTS] All retries exhausted, starting listening")
            startListening()
        }
    }

    // When speech ends, start listening
    utterance.onend = () => {
        console.log("[TTS] EVENT: onend - speech finished")
        startListening()
    }

    console.log("[TTS] Calling speechSynthesis.speak()")
    window.speechSynthesis.speak(utterance)
    console.log(
        "[TTS] speak() called, state - speaking:",
        window.speechSynthesis.speaking,
        "pending:",
        window.speechSynthesis.pending
    )

    // Workaround for Chrome bug where long text can cause TTS to stop
    // Keep speechSynthesis alive by resuming periodically
    // NOTE: This can break iOS Safari, so skip it on iOS
    if (!isIOS) {
        console.log("[TTS] Setting up Chrome keepAlive workaround (non-iOS)")
        const keepAlive = setInterval(() => {
            if (window.speechSynthesis.speaking) {
                console.log("[TTS] keepAlive: pause/resume")
                window.speechSynthesis.pause()
                window.speechSynthesis.resume()
            } else {
                console.log("[TTS] keepAlive: cleared (not speaking)")
                clearInterval(keepAlive)
            }
        }, 10000)
    } else {
        console.log("[TTS] Skipping Chrome keepAlive workaround (iOS detected)")
    }
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

// Log TTS support on startup
console.log("[TTS Init] speechSynthesis available:", !!window.speechSynthesis)
console.log("[TTS Init] SpeechRecognition available:", !!SpeechRecognition)
console.log("[TTS Init] User agent:", navigator.userAgent)
console.log("[TTS Init] iOS detected:", /iPad|iPhone|iPod/.test(navigator.userAgent))

if (window.speechSynthesis) {
    // Log initial voices (may be empty on iOS until onvoiceschanged fires)
    const initialVoices = window.speechSynthesis.getVoices()
    console.log("[TTS Init] Initial voices:", initialVoices.length)

    // Listen for voices to load (important for iOS)
    window.speechSynthesis.onvoiceschanged = () => {
        const voices = window.speechSynthesis.getVoices()
        console.log("[TTS Init] onvoiceschanged fired, voices:", voices.length)
        voices.forEach((v, i) => {
            if (i < 5) console.log(`[TTS Init]   Voice ${i}: ${v.name} (${v.lang}) default=${v.default}`)
        })
        if (voices.length > 5) console.log(`[TTS Init]   ... and ${voices.length - 5} more`)
    }
}

// Start
init()
