/**
 * Game Class - Web wrapper for MovieActor
 *
 * Wraps MovieActor and provides a simple interface for the web client.
 * Handles input parsing and emits events for state changes.
 */

import MovieActor, { DIFFICULTY, GAME_STATE, PLAYER, ITEM_TYPE } from "./MovieActor.js"

/**
 * Detect if input is a challenge command
 */
function isChallenge(input) {
    const lower = input.toLowerCase().trim()
    return lower === "challenge" || lower === "i challenge" || lower === "i challenge you"
}

/**
 * Detect difficulty from natural language input
 */
function detectDifficulty(input) {
    const lower = input.toLowerCase().trim()

    if (
        /\b(easy|simple|beginner|casual|relaxed|chill|laid\s*back)\b/.test(lower) ||
        lower === "1" ||
        /^(one|first)$/.test(lower)
    ) {
        return DIFFICULTY.EASY
    }

    if (
        /\b(hard|difficult|tough|challenging|expert|intense|brutal)\b/.test(lower) ||
        lower === "3" ||
        /^(three|third)$/.test(lower)
    ) {
        return DIFFICULTY.HARD
    }

    if (
        /\b(medium|normal|moderate|regular|standard|average|middle)\b/.test(lower) ||
        lower === "2" ||
        /^(two|second)$/.test(lower)
    ) {
        return DIFFICULTY.MEDIUM
    }

    return null
}

/**
 * Detect yes/no for prompts
 */
function detectYesNo(input) {
    const lower = input.toLowerCase().trim()

    if (/^(yes|yeah|yep|sure|ok|okay|absolutely|definitely|let'?s\s+(do\s+it|go|play))/.test(lower) || lower === "y") {
        return "yes"
    }

    if (/^(no|nah|nope|i'?m\s+good|no\s+thanks|not\s+right\s+now)/.test(lower) || lower === "n") {
        return "no"
    }

    return null
}

export default class Game {
    constructor(db) {
        this.db = db
        this.movieActor = null
        this.phase = "difficulty" // difficulty, playing, game_over
        this.lastOutput = null
        this.lastState = null
    }

    /**
     * Process freeform input and return response
     * Returns { output: string, state: object }
     */
    processInput(input) {
        const trimmed = input.trim()
        if (!trimmed) {
            return this._respond("Please enter something.")
        }

        switch (this.phase) {
            case "difficulty":
                return this._handleDifficultySelection(trimmed)
            case "playing":
                return this._handleGameInput(trimmed)
            case "game_over":
                return this._handleGameOver(trimmed)
            default:
                return this._respond("Something went wrong. Type 'restart' to start over.")
        }
    }

    /**
     * Get initial welcome message
     */
    getWelcome() {
        const output = [
            "MOVIE / ACTOR",
            "",
            "Take turns naming movies and actors!",
            'If you get stuck, say "challenge"',
            "First to win 5 rounds wins.",
            "",
            "How difficult would you like the game?",
            "  Easy   - Modern blockbusters, leading stars only",
            "  Medium - Classic films, main cast",
            "  Hard   - Deep cuts, entire cast",
            "",
            "Type easy, medium, or hard:"
        ].join("\n")

        return this._respond(output)
    }

    /**
     * Get last output (for reconnection)
     */
    getLastOutput() {
        return {
            output: this.lastOutput,
            state: this.lastState
        }
    }

    _handleDifficultySelection(input) {
        const difficulty = detectDifficulty(input)

        if (!difficulty) {
            return this._respond("I didn't catch that. Try saying easy, medium, or hard.")
        }

        // Create game instance
        this.movieActor = new MovieActor({
            db: this.db,
            difficulty,
            roundsToWin: 5,
            debug: false
        })

        const label = difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
        const result = this.movieActor.startGame()

        this.phase = "playing"

        const lines = [`${label} it is!`, "", this._formatStartMessage(result)]

        return this._respond(lines.join("\n"))
    }

    _handleGameInput(input) {
        // Check for restart
        if (input.toLowerCase() === "restart") {
            this.phase = "difficulty"
            this.movieActor = null
            return this.getWelcome()
        }

        // Check for challenge
        if (isChallenge(input)) {
            const result = this.movieActor.humanChallenge()
            return this._handleChallengeResult(result)
        }

        // Otherwise treat as movie/actor answer
        const result = this.movieActor.humanMove(input)

        if (!result.success) {
            return this._respond(this._formatIncorrect(result))
        }

        // Human was correct, now computer's turn
        const computerResult = this.movieActor.computerMove()

        // Check if computer gave up or game state changed
        if (!computerResult.success && this.movieActor.getState().state === GAME_STATE.ROUND_OVER) {
            return this._handleRoundEnd(computerResult, result)
        }

        const lines = [this._formatCorrect(result), "", this._formatComputerMove(computerResult)]

        return this._respond(lines.join("\n"))
    }

    _handleChallengeResult(result) {
        let lines = []

        if (result.roundWinner === PLAYER.HUMAN) {
            lines.push("You got me! I had nothing.")
        } else {
            const proof = result.proofItem
            if (proof.primary_name) {
                lines.push(`Actually, ${proof.primary_name} was in that!`)
            } else {
                const year = proof.start_year ? ` (${proof.start_year})` : ""
                lines.push(`Actually, they were in "${proof.primary_title}"${year}!`)
            }
        }

        lines.push("")
        lines.push(this._formatScore(result.scores))

        if (result.gameWinner) {
            this.phase = "game_over"
            lines.push("")
            lines.push(this._formatGameOver(result.gameWinner, result.scores))
        } else {
            // Automatically start next round
            const nextRound = this.movieActor.nextRound()
            lines.push("")
            lines.push(this._formatStartMessage(nextRound))
        }

        return this._respond(lines.join("\n"))
    }

    _handleRoundEnd(computerResult, humanResult) {
        const state = this.movieActor.getState()
        const lines = []

        if (humanResult) {
            lines.push(this._formatCorrect(humanResult))
            lines.push("")
        }

        lines.push("I can't think of anything... you win this round!")
        lines.push("")
        lines.push(this._formatScore(state.scores))

        if (state.state === GAME_STATE.GAME_OVER) {
            this.phase = "game_over"
            lines.push("")
            lines.push(this._formatGameOver(state.winner, state.scores))
        } else {
            // Automatically start next round
            const nextRound = this.movieActor.nextRound()
            lines.push("")
            lines.push(this._formatStartMessage(nextRound))
        }

        return this._respond(lines.join("\n"))
    }

    _handleGameOver(input) {
        const yesNo = detectYesNo(input)

        if (yesNo === "no") {
            return this._respond("Thanks for playing! Refresh to start a new game.")
        }

        // Restart
        this.phase = "difficulty"
        this.movieActor = null
        return this.getWelcome()
    }

    _formatStartMessage(result) {
        const state = this.movieActor.getState()
        const lines = []

        lines.push(`Round ${state.roundNumber}`)
        lines.push("")

        if (result.startingItemType === ITEM_TYPE.ACTOR) {
            lines.push(`Let's start with ${result.startingItem.primary_name}.`)
            //lines.push("Name a movie they were in.")
        } else {
            const year = result.startingItem.start_year ? ` from ${result.startingItem.start_year}` : ""
            lines.push(`Let's start with "${result.startingItem.primary_title}"${year}.`)
            //lines.push("Name an actor from that movie.")
        }

        return lines.join("\n")
    }

    _formatCorrect(result) {
        const item = result.matchedItem
        if (result.nextItemType === ITEM_TYPE.MOVIE) {
            return `Yes! ${item.primary_name}.`
        } else {
            const year = item.start_year ? ` (${item.start_year})` : ""
            return `Yes! "${item.primary_title}"${year}.`
        }
    }

    _formatIncorrect(result) {
        if (!result.found) {
            return `I couldn't find anything matching that. Try again.`
        } else if (result.alreadyUsed) {
            return `We already said that one. Try another.`
        } else {
            return `That doesn't connect. Try again.`
        }
    }

    _formatComputerMove(result) {
        if (!result.success) {
            return "I can't think of anything..."
        }

        const item = result.matchedItem
        if (result.nextItemType === ITEM_TYPE.ACTOR) {
            const year = item.start_year ? ` from ${item.start_year}` : ""
            return `How about "${item.primary_title}"${year}?\nName an actor from that movie.`
        } else {
            return `I'll say ${item.primary_name}.\nName a movie they were in.`
        }
    }

    _formatScore(scores) {
        return `Score: You ${scores[PLAYER.HUMAN]} - Computer ${scores[PLAYER.COMPUTER]}`
    }

    _formatGameOver(winner, scores) {
        const lines = []
        if (winner === PLAYER.HUMAN) {
            lines.push("YOU WIN!")
        } else {
            lines.push("Computer wins this time.")
        }
        lines.push(`Final: You ${scores[PLAYER.HUMAN]} - Computer ${scores[PLAYER.COMPUTER]}`)
        lines.push("")
        lines.push("Want to play again? (yes/no)")
        return lines.join("\n")
    }

    _respond(output) {
        const state = this._getSimpleState()
        this.lastOutput = output
        this.lastState = state
        return { output, state }
    }

    _getSimpleState() {
        if (!this.movieActor) {
            return {
                phase: this.phase,
                currentItem: null,
                currentItemType: null,
                scores: null,
                roundNumber: 0
            }
        }

        const s = this.movieActor.getState()
        return {
            phase: this.phase,
            currentItem: s.currentItem
                ? {
                      name: s.currentItem.primary_name || s.currentItem.primary_title,
                      year: s.currentItem.start_year || s.currentItem.birth_year
                  }
                : null,
            currentItemType: s.currentItemType,
            scores: s.scores,
            roundNumber: s.roundNumber
        }
    }
}
