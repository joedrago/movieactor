#!/usr/bin/env node

/**
 * CLI Playtester for MovieActor game
 *
 * A simple readline-based interface for playing the MovieActor game.
 */

import { createInterface } from "readline"
import Database from "better-sqlite3"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { existsSync } from "fs"
import MovieActor, { DIFFICULTY, GAME_STATE, PLAYER, ITEM_TYPE } from "./MovieActor.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DB_PATH = join(__dirname, "..", "data", "imdb.db")

class CLI {
    constructor() {
        this.game = null
        this.db = null
        this.rl = null
    }

    async run() {
        // Check database exists
        if (!existsSync(DB_PATH)) {
            console.log("\nError: Database not found at", DB_PATH)
            console.log("Run 'npm run gendb' to build the database first.\n")
            process.exit(1)
        }

        // Open database
        this.db = new Database(DB_PATH, { readonly: true })

        // Set up readline
        this.rl = createInterface({
            input: process.stdin,
            output: process.stdout
        })

        this.showWelcome()
        const difficulty = await this.selectDifficulty()

        // Create game instance
        this.game = new MovieActor({
            db: this.db,
            difficulty,
            roundsToWin: 5,
            debug: false
        })

        await this.gameLoop()
    }

    showWelcome() {
        console.log()
        console.log("=".repeat(50))
        console.log("           MOVIE / ACTOR GAME")
        console.log("=".repeat(50))
        console.log()
        console.log("Take turns naming movies and actors!")
        console.log("  - If shown an ACTOR, name a movie they were in")
        console.log("  - If shown a MOVIE, name an actor from it")
        console.log("  - First to win 5 rounds wins the game")
        console.log()
        console.log("Commands:")
        console.log("  challenge (or c) - Challenge when you're stuck")
        console.log("  restart (or r)   - Restart the game")
        console.log("  hint (or h)      - Show a hint")
        console.log("  used (or u)      - Show used items this round")
        console.log("  score (or s)     - Show current score")
        console.log("  quit (or q)      - Exit the game")
        console.log()
    }

    async selectDifficulty() {
        console.log("Select difficulty:")
        console.log("  1. Easy   - Computer only knows top-billed actors")
        console.log("  2. Medium - Computer knows top 10 billed actors")
        console.log("  3. Hard   - Computer knows entire cast")
        console.log()

        while (true) {
            const answer = await this.prompt("Difficulty (1-3): ")
            const choice = answer.trim()

            if (choice === "1" || choice.toLowerCase() === "easy") {
                console.log("\nDifficulty: Easy\n")
                return DIFFICULTY.EASY
            } else if (choice === "2" || choice.toLowerCase() === "medium") {
                console.log("\nDifficulty: Medium\n")
                return DIFFICULTY.MEDIUM
            } else if (choice === "3" || choice.toLowerCase() === "hard") {
                console.log("\nDifficulty: Hard\n")
                return DIFFICULTY.HARD
            }

            console.log("Please enter 1, 2, or 3")
        }
    }

    async gameLoop() {
        // Start the game
        let result = this.game.startGame()
        console.log(result.message)
        console.log()

        while (true) {
            const state = this.game.getState()

            if (state.state === GAME_STATE.GAME_OVER) {
                console.log()
                console.log("=".repeat(50))
                if (state.winner === PLAYER.HUMAN) {
                    console.log("  CONGRATULATIONS! YOU WIN!")
                } else {
                    console.log("  GAME OVER - Computer wins!")
                }
                console.log("  Final Score: You", state.scores[PLAYER.HUMAN], "- Computer", state.scores[PLAYER.COMPUTER])
                console.log("=".repeat(50))
                console.log()

                const playAgain = await this.prompt("Play again? (y/n): ")
                if (playAgain.toLowerCase().startsWith("y")) {
                    result = this.game.restart()
                    console.log()
                    console.log(result.message)
                    console.log()
                    continue
                } else {
                    break
                }
            }

            if (state.state === GAME_STATE.ROUND_OVER) {
                console.log()
                await this.prompt("Press Enter to start next round...")
                result = this.game.nextRound()
                console.log()
                console.log(result.message)
                console.log()
                continue
            }

            // Show current state
            this.displayState(state)

            // Get player input
            const input = await this.prompt("> ")
            const trimmed = input.trim()

            if (!trimmed) continue

            // Handle special commands
            const command = trimmed.toLowerCase()

            if (command === "quit" || command === "q") {
                console.log("\nThanks for playing!\n")
                break
            }

            if (command === "restart" || command === "r") {
                console.log("\nRestarting game...\n")
                result = this.game.restart()
                console.log(result.message)
                console.log()
                continue
            }

            if (command === "challenge" || command === "c") {
                result = this.game.humanChallenge()
                console.log()
                console.log(result.message)
                console.log()
                continue
            }

            if (command === "hint" || command === "h") {
                this.showHint(state)
                continue
            }

            if (command === "used" || command === "u") {
                this.showUsed(state)
                continue
            }

            if (command === "score" || command === "s") {
                console.log(`\nScore: You ${state.scores[PLAYER.HUMAN]} - Computer ${state.scores[PLAYER.COMPUTER]}\n`)
                continue
            }

            if (command === "help" || command === "?") {
                this.showHelp()
                continue
            }

            // Regular move
            result = this.game.humanMove(trimmed)
            console.log()
            console.log(result.message)

            if (result.success) {
                // Computer's turn
                console.log()
                console.log("Computer is thinking...")
                await this.delay(500 + Math.random() * 1000) // Simulate thinking

                const computerResult = this.game.computerMove()
                console.log(computerResult.message)
            }

            console.log()
        }

        this.cleanup()
    }

    displayState(state) {
        console.log("-".repeat(50))
        console.log(
            `Round ${state.roundNumber} | Score: You ${state.scores[PLAYER.HUMAN]} - Computer ${state.scores[PLAYER.COMPUTER]} | ${state.difficulty.toUpperCase()}`
        )
        console.log("-".repeat(50))

        if (state.currentItemType === ITEM_TYPE.MOVIE) {
            const movie = state.currentItem
            console.log(`Current: MOVIE - "${movie.primary_title}" (${movie.start_year})`)
            console.log("Your turn: Name an actor from this movie")
        } else {
            const actor = state.currentItem
            const years = actor.birth_year ? ` (b. ${actor.birth_year})` : ""
            console.log(`Current: ACTOR - ${actor.primary_name}${years}`)
            console.log("Your turn: Name a movie with this actor")
        }
        console.log()
    }

    showHint(state) {
        console.log("\nSearching for hints...\n")

        if (state.currentItemType === ITEM_TYPE.MOVIE) {
            // Show some actors in this movie
            const cast = this.game.getMovieCast(state.currentItem.tconst)
            const available = cast.filter((a) => !state.usedActors.includes(a.nconst))

            if (available.length === 0) {
                console.log("No unused actors found! Try challenging.")
            } else {
                console.log("Some actors in this movie:")
                available.slice(0, 3).forEach((a) => {
                    console.log(`  - ${a.primary_name}`)
                })
            }
        } else {
            // Show some movies with this actor
            const movies = this.game.getActorMovies(state.currentItem.nconst)
            const available = movies.filter((m) => !state.usedMovies.includes(m.tconst))

            if (available.length === 0) {
                console.log("No unused movies found! Try challenging.")
            } else {
                console.log("Some movies with this actor:")
                available.slice(0, 3).forEach((m) => {
                    console.log(`  - ${m.primary_title} (${m.start_year})`)
                })
            }
        }
        console.log()
    }

    showUsed(state) {
        console.log("\nUsed this round:")

        if (state.usedActors.length === 0 && state.usedMovies.length === 0) {
            console.log("  (nothing yet)")
        } else {
            if (state.usedMovies.length > 0) {
                // Look up movie names
                const movieNames = state.usedMovies.map((tconst) => {
                    const stmt = this.db.prepare("SELECT primary_title, start_year FROM title_basics WHERE tconst = ?")
                    const m = stmt.get(tconst)
                    return m ? `${m.primary_title} (${m.start_year})` : tconst
                })
                console.log("  Movies:", movieNames.join(", "))
            }

            if (state.usedActors.length > 0) {
                // Look up actor names
                const actorNames = state.usedActors.map((nconst) => {
                    const stmt = this.db.prepare("SELECT primary_name FROM name_basics WHERE nconst = ?")
                    const a = stmt.get(nconst)
                    return a ? a.primary_name : nconst
                })
                console.log("  Actors:", actorNames.join(", "))
            }
        }
        console.log()
    }

    showHelp() {
        console.log("\nCommands:")
        console.log("  <name>           - Enter a movie or actor name")
        console.log("  challenge (c)    - Challenge when you can't answer")
        console.log("  hint (h)         - Show available answers")
        console.log("  used (u)         - Show items used this round")
        console.log("  score (s)        - Show current score")
        console.log("  restart (r)      - Restart the game")
        console.log("  quit (q)         - Exit the game")
        console.log("  help (?)         - Show this help")
        console.log()
    }

    prompt(message) {
        return new Promise((resolve) => {
            this.rl.question(message, resolve)
        })
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    cleanup() {
        if (this.rl) {
            this.rl.close()
        }
        if (this.db) {
            this.db.close()
        }
    }
}

// Handle process termination
process.on("SIGINT", () => {
    console.log("\n\nGoodbye!\n")
    process.exit(0)
})

// Run the CLI
const cli = new CLI()
cli.run().catch((err) => {
    console.error("Error:", err.message)
    process.exit(1)
})
