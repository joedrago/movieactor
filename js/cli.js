#!/usr/bin/env node

/**
 * CLI Playtester for MovieActor game
 *
 * A natural language friendly interface for playing the MovieActor game.
 * Designed to be playable via voice input.
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

/**
 * Detect if input is a challenge command
 * Only "challenge" is a special command during gameplay to avoid ambiguity with movie/actor names
 */
function isChallenge(input) {
    const lower = input.toLowerCase().trim()
    return lower === "challenge" || lower === "i challenge" || lower === "i challenge you"
}

/**
 * Detect yes/no for play again prompt
 */
function detectYesNo(input) {
    const lower = input.toLowerCase().trim()

    // Yes patterns
    if (/^(yes|yeah|yep|sure|ok|okay|absolutely|definitely|let'?s\s+(do\s+it|go|play))/.test(lower) || lower === "y") {
        return "yes"
    }

    // No patterns
    if (/^(no|nah|nope|i'?m\s+good|no\s+thanks|not\s+right\s+now)/.test(lower) || lower === "n") {
        return "no"
    }

    return null
}

/**
 * Detect difficulty from natural language input
 */
function detectDifficulty(input) {
    const lower = input.toLowerCase().trim()

    // Easy patterns
    if (
        /\b(easy|simple|beginner|casual|relaxed|chill|laid\s*back)\b/.test(lower) ||
        lower === "1" ||
        /^(one|first)$/.test(lower)
    ) {
        return DIFFICULTY.EASY
    }

    // Hard patterns
    if (
        /\b(hard|difficult|tough|challenging|expert|intense|brutal)\b/.test(lower) ||
        lower === "3" ||
        /^(three|third)$/.test(lower)
    ) {
        return DIFFICULTY.HARD
    }

    // Medium patterns (default fallback for anything reasonable)
    if (
        /\b(medium|normal|moderate|regular|standard|average|middle)\b/.test(lower) ||
        lower === "2" ||
        /^(two|second)$/.test(lower)
    ) {
        return DIFFICULTY.MEDIUM
    }

    return null
}

class CLI {
    constructor() {
        this.game = null
        this.db = null
        this.rl = null
    }

    async run() {
        // Check database exists
        if (!existsSync(DB_PATH)) {
            console.log("\nDatabase not found at", DB_PATH)
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
        console.log("           MOVIE / ACTOR")
        console.log("=".repeat(50))
        console.log()
        console.log("Take turns naming movies and actors!")
        console.log('If you get stuck, say "challenge"')
        console.log("First to win 5 rounds wins.")
        console.log()
    }

    async selectDifficulty() {
        console.log("How difficult would you like the game?")
        console.log("  Easy   - Modern blockbusters, leading stars only")
        console.log("  Medium - Classic films, main cast")
        console.log("  Hard   - Deep cuts, entire cast")
        console.log()

        while (true) {
            const answer = await this.prompt("Difficulty: ")
            const difficulty = detectDifficulty(answer)

            if (difficulty) {
                const label = difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
                console.log(`\n${label} it is!\n`)
                return difficulty
            }

            console.log("I didn't catch that. Try saying easy, medium, or hard.")
        }
    }

    async gameLoop() {
        // Start the game
        let result = this.game.startGame()
        this.announceStart(result)

        while (true) {
            const state = this.game.getState()

            if (state.state === GAME_STATE.GAME_OVER) {
                console.log()
                console.log("=".repeat(50))
                if (state.winner === PLAYER.HUMAN) {
                    console.log("  YOU WIN!")
                } else {
                    console.log("  Computer wins this time.")
                }
                console.log(`  Final: You ${state.scores[PLAYER.HUMAN]} - Computer ${state.scores[PLAYER.COMPUTER]}`)
                console.log("=".repeat(50))
                console.log()

                const playAgain = await this.prompt("Want to play again? ")
                const answer = detectYesNo(playAgain)

                if (answer === "no") {
                    break
                }
                // Anything other than explicit "no" means yes
                result = this.game.restart()
                console.log()
                this.announceStart(result)
                continue
            }

            if (state.state === GAME_STATE.ROUND_OVER) {
                console.log()
                await this.prompt("Ready for the next round? ")
                result = this.game.nextRound()
                console.log()
                this.announceStart(result)
                continue
            }

            // Show current state
            this.displayPrompt(state)

            // Get player input
            const input = await this.prompt("> ")
            const trimmed = input.trim()

            if (!trimmed) continue

            // Check for challenge command
            if (isChallenge(trimmed)) {
                result = this.game.humanChallenge()
                console.log()
                this.announceChallenge(result)
                continue
            }

            // Otherwise treat as movie/actor answer
            result = this.game.humanMove(trimmed)
            console.log()

            if (result.success) {
                this.announceCorrect(result)

                // Computer's turn
                console.log()
                await this.delay(500 + Math.random() * 1000)

                const computerResult = this.game.computerMove()
                this.announceComputerMove(computerResult)
            } else {
                this.announceIncorrect(result)
            }
            console.log()
        }

        this.cleanup()
    }

    announceStart(result) {
        if (result.startingItemType === ITEM_TYPE.ACTOR) {
            console.log(`Let's start with ${result.startingItem.primary_name}.`)
            console.log("Name a movie they were in.")
        } else {
            const year = result.startingItem.start_year ? ` from ${result.startingItem.start_year}` : ""
            console.log(`Let's start with "${result.startingItem.primary_title}"${year}.`)
            console.log("Name an actor from that movie.")
        }
        console.log()
    }

    displayPrompt(state) {
        const scores = `You ${state.scores[PLAYER.HUMAN]} - Computer ${state.scores[PLAYER.COMPUTER]}`
        console.log(`[Round ${state.roundNumber} | ${scores}]`)

        if (state.currentItemType === ITEM_TYPE.MOVIE) {
            const year = state.currentItem.start_year ? ` (${state.currentItem.start_year})` : ""
            console.log(`The movie is "${state.currentItem.primary_title}"${year}`)
        } else {
            console.log(`The actor is ${state.currentItem.primary_name}`)
        }
    }

    announceCorrect(result) {
        const item = result.matchedItem
        if (result.nextItemType === ITEM_TYPE.MOVIE) {
            // They named an actor, next is movie
            console.log(`Yes! ${item.primary_name}.`)
        } else {
            // They named a movie, next is actor
            const year = item.start_year ? ` (${item.start_year})` : ""
            console.log(`Yes! "${item.primary_title}"${year}.`)
        }
    }

    announceIncorrect(result) {
        if (!result.found) {
            console.log(`I couldn't find anything matching that. Try again.`)
        } else if (result.alreadyUsed) {
            console.log(`We already said that one. Try another.`)
        } else {
            console.log(`That doesn't connect. Try again.`)
        }
    }

    announceComputerMove(result) {
        if (!result.success) {
            // Computer gave up
            console.log("I can't think of anything... you win this round!")
            return
        }

        const item = result.matchedItem
        if (result.nextItemType === ITEM_TYPE.ACTOR) {
            // Computer named a movie
            const year = item.start_year ? ` from ${item.start_year}` : ""
            console.log(`How about "${item.primary_title}"${year}?`)
            console.log("Name an actor from that movie.")
        } else {
            // Computer named an actor
            console.log(`I'll say ${item.primary_name}.`)
            console.log("Name a movie they were in.")
        }
    }

    announceChallenge(result) {
        if (result.roundWinner === PLAYER.HUMAN) {
            console.log("You got me! I had nothing.")
            console.log(
                `You win the round. Score: You ${result.scores[PLAYER.HUMAN]} - Computer ${result.scores[PLAYER.COMPUTER]}`
            )
        } else {
            const proof = result.proofItem
            if (proof.primary_name) {
                console.log(`Actually, ${proof.primary_name} was in that!`)
            } else {
                const year = proof.start_year ? ` (${proof.start_year})` : ""
                console.log(`Actually, they were in "${proof.primary_title}"${year}!`)
            }
            console.log(`I win the round. Score: You ${result.scores[PLAYER.HUMAN]} - Computer ${result.scores[PLAYER.COMPUTER]}`)
        }
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
