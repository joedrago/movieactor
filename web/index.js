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

// State
let gameId = null
let socket = null

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
        addMessage("(Reconnected to your game)", "system")
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
    msg.textContent = text
    chat.appendChild(msg)
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

// Start
init()
