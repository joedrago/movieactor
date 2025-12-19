#!/usr/bin/env node

/**
 * Web Server for MovieActor game
 *
 * Express server with Socket.IO for real-time game communication.
 */

import express from "express"
import { createServer } from "http"
import { Server } from "socket.io"
import Database from "better-sqlite3"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import Game from "./js/Game.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DB_PATH = join(__dirname, "data", "imdb.db")
const WEB_PATH = join(__dirname, "web")
const PORT = process.env.PORT || 3070
const GAME_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

// Check database exists
if (!existsSync(DB_PATH)) {
    console.error("Database not found at", DB_PATH)
    console.error("Run 'npm run imdb' to build the database first.")
    process.exit(1)
}

// Open database (shared read-only connection)
const db = new Database(DB_PATH, { readonly: true })

// Games map: gameId -> { game: Game, socketId: string, lastActivity: number, timeoutId: NodeJS.Timeout }
const games = new Map()

// Generate random game ID (consonants only for easy pronunciation)
function generateGameId() {
    const consonants = "bcdfghjklmnpqrstvwxyz"
    let id = ""
    for (let i = 0; i < 6; i++) {
        id += consonants[Math.floor(Math.random() * consonants.length)]
    }
    // Ensure uniqueness
    if (games.has(id)) {
        return generateGameId()
    }
    return id
}

// Set up Express
const app = express()
app.use(express.static(WEB_PATH))

// Create HTTP server and Socket.IO
const httpServer = createServer(app)
const io = new Server(httpServer)

// Handle socket connections
io.on("connection", (socket) => {
    console.log(`Client connected: ${socket.id}`)

    let currentGameId = null

    // Client requests a new game
    socket.on("new-game", () => {
        // Clean up any existing game for this socket
        if (currentGameId && games.has(currentGameId)) {
            const gameData = games.get(currentGameId)
            if (gameData.timeoutId) {
                clearTimeout(gameData.timeoutId)
            }
            games.delete(currentGameId)
        }

        const gameId = generateGameId()
        const game = new Game(db)

        games.set(gameId, {
            game,
            socketId: socket.id,
            lastActivity: Date.now(),
            timeoutId: null
        })

        currentGameId = gameId

        // Send game ID and welcome message
        const welcome = game.getWelcome()
        socket.emit("game-created", { gameId })
        socket.emit("output", welcome)

        console.log(`New game created: ${gameId}`)
    })

    // Client reconnects with existing game ID
    socket.on("rejoin-game", (gameId) => {
        if (!games.has(gameId)) {
            socket.emit("error", { message: "Game not found. Starting a new game." })
            socket.emit("new-game-required")
            return
        }

        const gameData = games.get(gameId)

        // Clear any pending timeout
        if (gameData.timeoutId) {
            clearTimeout(gameData.timeoutId)
            gameData.timeoutId = null
        }

        // Update socket reference
        gameData.socketId = socket.id
        gameData.lastActivity = Date.now()
        currentGameId = gameId

        // Send last output to remind user where they were
        const lastOutput = gameData.game.getLastOutput()
        if (lastOutput.output) {
            socket.emit("output", lastOutput)
            socket.emit("reconnected", { gameId })
        }

        console.log(`Client rejoined game: ${gameId}`)
    })

    // Client sends input
    socket.on("input", (data) => {
        const { gameId, text } = data

        if (!games.has(gameId)) {
            socket.emit("error", { message: "Game not found. Please start a new game." })
            socket.emit("new-game-required")
            return
        }

        const gameData = games.get(gameId)
        gameData.lastActivity = Date.now()

        try {
            const result = gameData.game.processInput(text)
            socket.emit("output", result)
        } catch (err) {
            console.error(`Error processing input for game ${gameId}:`, err)
            socket.emit("error", { message: "An error occurred. Please try again." })
        }
    })

    // Handle disconnection
    socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`)

        if (currentGameId && games.has(currentGameId)) {
            const gameData = games.get(currentGameId)

            // Set timeout to clean up game after 5 minutes
            gameData.timeoutId = setTimeout(() => {
                if (games.has(currentGameId)) {
                    games.delete(currentGameId)
                    console.log(`Game ${currentGameId} aged out after 5 minutes`)
                }
            }, GAME_TIMEOUT_MS)

            console.log(`Game ${currentGameId} will be cleaned up in 5 minutes if no reconnection`)
        }
    })
})

// Start server
httpServer.listen(PORT, () => {
    console.log(`MovieActor web server running at http://localhost:${PORT}`)
})

// Handle shutdown
process.on("SIGINT", () => {
    console.log("\nShutting down...")
    db.close()
    process.exit(0)
})
