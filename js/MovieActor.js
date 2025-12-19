/**
 * MovieActor Game Class
 *
 * A turn-based game where players alternate naming actors and movies.
 * No I/O - exposes methods for UI to call and returns state/results.
 */

// Game constants
export const DIFFICULTY = {
    EASY: "easy",
    MEDIUM: "medium",
    HARD: "hard"
}

export const PLAYER = {
    HUMAN: "human",
    COMPUTER: "computer"
}

export const ITEM_TYPE = {
    MOVIE: "movie",
    ACTOR: "actor"
}

export const GAME_STATE = {
    IDLE: "idle",
    PLAYING: "playing",
    CHALLENGE_PENDING: "challenge_pending",
    ROUND_OVER: "round_over",
    GAME_OVER: "game_over"
}

/**
 * Difficulty Configuration
 *
 * Controls what the computer "knows" about movies and actors.
 * Note: Human answers are always validated against the full database (omniscient validation).
 * These settings only limit what the computer can pick and what it considers when challenged.
 *
 * Parameters:
 *   maxOrdering     - Maximum cast billing position (1 = lead, higher = smaller roles)
 *   minYear         - Oldest movie year the computer knows
 *   minVotes        - Minimum IMDB votes for movies the computer knows (proxy for fame)
 *   minVotesForStart - Minimum votes for movies/actors used to start a round
 *   minActorMovies  - Minimum filmography size for starting actors
 */
const DIFFICULTY_CONFIG = {
    [DIFFICULTY.EASY]: {
        // Computer only knows modern blockbusters and leading stars
        // Post-1980 movies with 100k+ votes, only top 3 billed actors
        maxOrdering: 3,
        minYear: 1980,
        minVotes: 100000,
        minVotesForStart: 200000,
        minActorMovies: 15
    },
    [DIFFICULTY.MEDIUM]: {
        // Computer knows popular movies and main cast
        // Post-1960 movies with 10k+ votes, top 10 billed actors
        maxOrdering: 10,
        minYear: 1960,
        minVotes: 10000,
        minVotesForStart: 50000,
        minActorMovies: 8
    },
    [DIFFICULTY.HARD]: {
        // Computer knows nearly everything
        // All years, any movie with 1k+ votes, entire cast
        maxOrdering: 999,
        minYear: 1900,
        minVotes: 1000,
        minVotesForStart: 5000,
        minActorMovies: 3
    }
}

export default class MovieActor {
    /**
     * @param {Object} options
     * @param {Database} options.db - better-sqlite3 database instance
     * @param {string} options.difficulty - "easy", "medium", or "hard"
     * @param {number} options.roundsToWin - Number of rounds to win (default 5)
     * @param {boolean} options.debug - Enable debug logging
     */
    constructor(options = {}) {
        const { db, difficulty = DIFFICULTY.MEDIUM, roundsToWin = 5, debug = false } = options

        if (!db) {
            throw new Error("Database instance is required")
        }

        this.db = db
        this.difficulty = difficulty
        this.roundsToWin = roundsToWin
        this.debug = debug
        this.config = DIFFICULTY_CONFIG[difficulty]

        if (!this.config) {
            throw new Error(`Invalid difficulty: ${difficulty}`)
        }

        // Prepare SQL statements
        this._prepareStatements()

        // Initialize game state
        this._resetState()
    }

    /**
     * Prepare all SQL statements for reuse
     */
    _prepareStatements() {
        // Fuzzy search for actors by name
        this.stmtSearchActors = this.db.prepare(`
            SELECT n.nconst, n.primary_name, n.birth_year, n.death_year,
                   COUNT(DISTINCT tp.tconst) as movie_count
            FROM name_basics_fts fts
            JOIN name_basics n ON fts.nconst = n.nconst
            JOIN title_principals tp ON n.nconst = tp.nconst
            JOIN title_basics t ON tp.tconst = t.tconst
            WHERE fts.primary_name MATCH ?
              AND tp.category IN ('actor', 'actress')
              AND t.title_type = 'movie'
            GROUP BY n.nconst
            ORDER BY movie_count DESC
            LIMIT ?
        `)

        // Fuzzy search for movies by title
        this.stmtSearchMovies = this.db.prepare(`
            SELECT t.tconst, t.primary_title, t.start_year,
                   r.average_rating, r.num_votes
            FROM title_basics_fts fts
            JOIN title_basics t ON fts.tconst = t.tconst
            LEFT JOIN title_ratings r ON t.tconst = r.tconst
            WHERE fts.primary_title MATCH ?
              AND t.title_type = 'movie'
            ORDER BY COALESCE(r.num_votes, 0) DESC
            LIMIT ?
        `)

        // LIKE-based fallback search for actors
        this.stmtSearchActorsLike = this.db.prepare(`
            SELECT n.nconst, n.primary_name, n.birth_year, n.death_year,
                   COUNT(DISTINCT tp.tconst) as movie_count
            FROM name_basics n
            JOIN title_principals tp ON n.nconst = tp.nconst
            JOIN title_basics t ON tp.tconst = t.tconst
            WHERE LOWER(n.primary_name) LIKE ?
              AND tp.category IN ('actor', 'actress')
              AND t.title_type = 'movie'
            GROUP BY n.nconst
            ORDER BY movie_count DESC
            LIMIT ?
        `)

        // LIKE-based fallback search for movies
        this.stmtSearchMoviesLike = this.db.prepare(`
            SELECT t.tconst, t.primary_title, t.start_year,
                   r.average_rating, r.num_votes
            FROM title_basics t
            LEFT JOIN title_ratings r ON t.tconst = r.tconst
            WHERE LOWER(t.primary_title) LIKE ?
              AND t.title_type = 'movie'
            ORDER BY COALESCE(r.num_votes, 0) DESC
            LIMIT ?
        `)

        // Get actors in a movie (with ordering filter)
        this.stmtGetMovieCast = this.db.prepare(`
            SELECT n.nconst, n.primary_name, n.birth_year, tp.ordering, tp.characters
            FROM title_principals tp
            JOIN name_basics n ON tp.nconst = n.nconst
            WHERE tp.tconst = ?
              AND tp.category IN ('actor', 'actress')
              AND tp.ordering <= ?
            ORDER BY tp.ordering
        `)

        // Get movies for an actor (with ordering filter)
        this.stmtGetActorMovies = this.db.prepare(`
            SELECT t.tconst, t.primary_title, t.start_year, tp.ordering,
                   r.average_rating, r.num_votes
            FROM title_principals tp
            JOIN title_basics t ON tp.tconst = t.tconst
            LEFT JOIN title_ratings r ON t.tconst = r.tconst
            WHERE tp.nconst = ?
              AND tp.category IN ('actor', 'actress')
              AND t.title_type = 'movie'
              AND tp.ordering <= ?
            ORDER BY COALESCE(r.num_votes, 0) DESC
        `)

        // Check if actor is in movie (omniscient - no ordering filter for validation)
        this.stmtValidateActorInMovie = this.db.prepare(`
            SELECT tp.ordering, tp.characters
            FROM title_principals tp
            WHERE tp.tconst = ?
              AND tp.nconst = ?
              AND tp.category IN ('actor', 'actress')
        `)

        // Get random popular actor (for starting)
        // Params: minVotesForStart, minYear, maxOrdering, minActorMovies
        this.stmtRandomActor = this.db.prepare(`
            SELECT n.nconst, n.primary_name, n.birth_year,
                   COUNT(DISTINCT tp.tconst) as movie_count
            FROM name_basics n
            JOIN title_principals tp ON n.nconst = tp.nconst
            JOIN title_basics t ON tp.tconst = t.tconst
            JOIN title_ratings r ON t.tconst = r.tconst
            WHERE tp.category IN ('actor', 'actress')
              AND t.title_type = 'movie'
              AND r.num_votes >= ?
              AND t.start_year >= ?
              AND tp.ordering <= ?
            GROUP BY n.nconst
            HAVING movie_count >= ?
            ORDER BY RANDOM()
            LIMIT 1
        `)

        // Get random popular movie (for starting)
        // Params: minVotesForStart, minYear
        this.stmtRandomMovie = this.db.prepare(`
            SELECT t.tconst, t.primary_title, t.start_year,
                   r.average_rating, r.num_votes
            FROM title_basics t
            JOIN title_ratings r ON t.tconst = r.tconst
            WHERE t.title_type = 'movie'
              AND r.num_votes >= ?
              AND t.start_year >= ?
            ORDER BY RANDOM()
            LIMIT 1
        `)

        // Computer pick: find valid actor for a movie (not already used)
        // We'll build this dynamically since we need to exclude used IDs
        // Base params: tconst, maxOrdering
        // Additional filters for year/votes applied via the movie already being selected
        this.stmtComputerPickActorBase = `
            SELECT n.nconst, n.primary_name, n.birth_year, tp.ordering,
                   (SELECT COUNT(*) FROM title_principals WHERE nconst = n.nconst
                    AND category IN ('actor', 'actress')) as career_size
            FROM title_principals tp
            JOIN name_basics n ON tp.nconst = n.nconst
            WHERE tp.tconst = ?
              AND tp.category IN ('actor', 'actress')
              AND tp.ordering <= ?
        `

        // Computer pick: find valid movie for an actor (not already used)
        // Base params: nconst, maxOrdering, minYear, minVotes
        this.stmtComputerPickMovieBase = `
            SELECT t.tconst, t.primary_title, t.start_year, tp.ordering,
                   (SELECT COUNT(*) FROM title_principals WHERE tconst = t.tconst
                    AND category IN ('actor', 'actress')) as cast_size,
                   r.num_votes
            FROM title_principals tp
            JOIN title_basics t ON tp.tconst = t.tconst
            LEFT JOIN title_ratings r ON t.tconst = r.tconst
            WHERE tp.nconst = ?
              AND tp.category IN ('actor', 'actress')
              AND t.title_type = 'movie'
              AND tp.ordering <= ?
              AND t.start_year >= ?
              AND COALESCE(r.num_votes, 0) >= ?
        `
    }

    /**
     * Reset all game state
     */
    _resetState() {
        this.state = GAME_STATE.IDLE
        this.currentPlayer = null
        this.currentItemType = null
        this.currentItem = null
        this.usedActors = new Set() // nconst values
        this.usedMovies = new Set() // tconst values
        this.scores = {
            [PLAYER.HUMAN]: 0,
            [PLAYER.COMPUTER]: 0
        }
        this.roundNumber = 0
        this.winner = null
        this.lastMoveMessage = null
    }

    /**
     * Log debug messages
     */
    _log(...args) {
        if (this.debug) {
            console.log("[MovieActor]", ...args)
        }
    }

    /**
     * Normalize user input for searching (light normalization, preserves punctuation for FTS)
     */
    _normalizeInput(input) {
        return input.replace(/\s+/g, " ").trim()
    }

    /**
     * Normalize for LIKE fallback (strips punctuation)
     */
    _normalizeForLike(input) {
        return input
            .toLowerCase()
            .replace(/[^\w\s]/g, "")
            .replace(/\s+/g, " ")
            .trim()
    }

    /**
     * Convert input to FTS5 queries (returns array of queries to try)
     */
    _toFtsQueries(input) {
        const queries = []
        const seen = new Set()

        const addQuery = (q) => {
            if (!seen.has(q)) {
                seen.add(q)
                queries.push(q)
            }
        }

        const escape = (s) => s.replace(/"/g, '""')

        // Try variations: original, then with punctuation removed
        const variations = [input]

        // Remove hyphens and other punctuation (but keep letters, numbers, spaces)
        const noPunctuation = input.replace(/[^\w\s]/g, "")
        if (noPunctuation !== input) variations.push(noPunctuation)

        for (const variant of variations) {
            // As phrase
            addQuery(`"${escape(variant)}"`)

            // Individual words with AND (skip words < 3 chars, trigrams can't match them)
            const words = variant.split(/\s+/).filter((w) => w.length >= 3)
            if (words.length > 1) {
                addQuery(words.map((w) => `"${escape(w)}"`).join(" AND "))
            } else if (words.length === 1) {
                addQuery(`"${escape(words[0])}"`)
            }
        }

        return queries
    }

    /**
     * Get current game state for UI
     */
    getState() {
        return {
            state: this.state,
            currentPlayer: this.currentPlayer,
            currentItemType: this.currentItemType,
            currentItem: this.currentItem,
            scores: { ...this.scores },
            roundNumber: this.roundNumber,
            roundsToWin: this.roundsToWin,
            usedActors: [...this.usedActors],
            usedMovies: [...this.usedMovies],
            winner: this.winner,
            difficulty: this.difficulty,
            lastMoveMessage: this.lastMoveMessage
        }
    }

    /**
     * Search for actors by name (fuzzy)
     */
    searchActors(query, limit = 10) {
        const normalized = this._normalizeInput(query)
        if (!normalized) return []

        this._log("Searching actors:", normalized)

        // Try FTS5 queries
        const ftsQueries = this._toFtsQueries(normalized)
        for (const ftsQuery of ftsQueries) {
            try {
                const results = this.stmtSearchActors.all(ftsQuery, limit)
                if (results.length > 0) {
                    this._log("FTS5 found:", results.length, "actors with query:", ftsQuery)
                    return results
                }
            } catch (e) {
                this._log("FTS5 search failed:", e.message)
            }
        }

        // Fallback to LIKE
        const likeNormalized = this._normalizeForLike(query)
        const likePattern = `%${likeNormalized}%`
        const results = this.stmtSearchActorsLike.all(likePattern, limit)
        this._log("LIKE found:", results.length, "actors")
        return results
    }

    /**
     * Search for movies by title (fuzzy)
     */
    searchMovies(query, limit = 10) {
        const normalized = this._normalizeInput(query)
        if (!normalized) return []

        this._log("Searching movies:", normalized)

        // Try FTS5 queries
        const ftsQueries = this._toFtsQueries(normalized)
        for (const ftsQuery of ftsQueries) {
            try {
                const results = this.stmtSearchMovies.all(ftsQuery, limit)
                if (results.length > 0) {
                    this._log("FTS5 found:", results.length, "movies with query:", ftsQuery)
                    return results
                }
            } catch (e) {
                this._log("FTS5 search failed:", e.message)
            }
        }

        // Fallback to LIKE
        const likeNormalized = this._normalizeForLike(query)
        const likePattern = `%${likeNormalized}%`
        const results = this.stmtSearchMoviesLike.all(likePattern, limit)
        this._log("LIKE found:", results.length, "movies")
        return results
    }

    /**
     * Get actors in a specific movie
     */
    getMovieCast(tconst) {
        return this.stmtGetMovieCast.all(tconst, this.config.maxOrdering)
    }

    /**
     * Get movies for a specific actor
     */
    getActorMovies(nconst) {
        return this.stmtGetActorMovies.all(nconst, this.config.maxOrdering)
    }

    /**
     * Validate that an actor is in a movie (omniscient - ignores difficulty)
     */
    _validateActorInMovie(actorNconst, movieTconst) {
        const result = this.stmtValidateActorInMovie.get(movieTconst, actorNconst)
        return result !== undefined
    }

    /**
     * Start a new game
     */
    startGame() {
        this._resetState()
        this.state = GAME_STATE.PLAYING
        this.roundNumber = 1

        this._log("Game started, difficulty:", this.difficulty)

        return this.startRound()
    }

    /**
     * Start a new round - computer picks a random starting item
     */
    startRound() {
        // Clear used items for new round
        this.usedActors.clear()
        this.usedMovies.clear()

        // Randomly decide to start with movie or actor
        const startWithActor = Math.random() < 0.5

        if (startWithActor) {
            // Pick a random popular actor
            const actor = this.stmtRandomActor.get(
                this.config.minVotesForStart,
                this.config.minYear,
                this.config.maxOrdering,
                this.config.minActorMovies
            )

            if (!actor) {
                return {
                    success: false,
                    message: "Could not find a suitable starting actor. Try rebuilding the database."
                }
            }

            this.currentItem = actor
            this.currentItemType = ITEM_TYPE.ACTOR
            this.usedActors.add(actor.nconst)
            this.currentPlayer = PLAYER.HUMAN // Human responds first

            this._log("Round started with actor:", actor.primary_name)

            this.lastMoveMessage = `Computer starts with actor: ${actor.primary_name}`
            return {
                success: true,
                startingItem: actor,
                startingItemType: ITEM_TYPE.ACTOR,
                firstPlayer: PLAYER.HUMAN,
                message: `Round ${this.roundNumber} begins! The starting actor is "${actor.primary_name}". Name a movie they were in.`
            }
        } else {
            // Pick a random popular movie
            const movie = this.stmtRandomMovie.get(this.config.minVotesForStart, this.config.minYear)

            if (!movie) {
                return {
                    success: false,
                    message: "Could not find a suitable starting movie. Try rebuilding the database."
                }
            }

            this.currentItem = movie
            this.currentItemType = ITEM_TYPE.MOVIE
            this.usedMovies.add(movie.tconst)
            this.currentPlayer = PLAYER.HUMAN // Human responds first

            this._log("Round started with movie:", movie.primary_title)

            this.lastMoveMessage = `Computer starts with movie: ${movie.primary_title} (${movie.start_year})`
            return {
                success: true,
                startingItem: movie,
                startingItemType: ITEM_TYPE.MOVIE,
                firstPlayer: PLAYER.HUMAN,
                message: `Round ${this.roundNumber} begins! The starting movie is "${movie.primary_title}" (${movie.start_year}). Name an actor from this movie.`
            }
        }
    }

    /**
     * Human submits an answer
     */
    humanMove(input) {
        if (this.state !== GAME_STATE.PLAYING) {
            return {
                success: false,
                message: `Cannot make a move in state: ${this.state}`
            }
        }

        if (this.currentPlayer !== PLAYER.HUMAN) {
            return {
                success: false,
                message: "It's not your turn!"
            }
        }

        const normalized = this._normalizeInput(input)
        if (!normalized) {
            return {
                success: false,
                found: false,
                message: "Please enter a valid name."
            }
        }

        // Determine what we're looking for
        if (this.currentItemType === ITEM_TYPE.MOVIE) {
            // Human needs to name an actor from the current movie
            return this._humanPicksActor(normalized)
        } else {
            // Human needs to name a movie with the current actor
            return this._humanPicksMovie(normalized)
        }
    }

    /**
     * Human picks an actor for the current movie
     */
    _humanPicksActor(query) {
        // Search for the actor
        const actors = this.searchActors(query, 5)

        if (actors.length === 0) {
            return {
                success: false,
                found: false,
                message: `Couldn't find any actor matching "${query}". Try again.`
            }
        }

        // Try to find a match that's in the current movie
        for (const actor of actors) {
            if (this._validateActorInMovie(actor.nconst, this.currentItem.tconst)) {
                // Check if already used
                if (this.usedActors.has(actor.nconst)) {
                    return {
                        success: false,
                        found: true,
                        matchedItem: actor,
                        alreadyUsed: true,
                        message: `"${actor.primary_name}" has already been named this round. Try another actor.`
                    }
                }

                // Valid move!
                this.usedActors.add(actor.nconst)
                this.currentItem = actor
                this.currentItemType = ITEM_TYPE.ACTOR
                this.currentPlayer = PLAYER.COMPUTER

                this._log("Human picked actor:", actor.primary_name)

                this.lastMoveMessage = `You named: ${actor.primary_name}`
                return {
                    success: true,
                    found: true,
                    matchedItem: actor,
                    valid: true,
                    alreadyUsed: false,
                    nextItemType: ITEM_TYPE.MOVIE,
                    nextPlayer: PLAYER.COMPUTER,
                    message: `"${actor.primary_name}" - correct! Computer's turn to name a movie with this actor.`
                }
            }
        }

        // Found actors but none in the movie
        const bestMatch = actors[0]
        return {
            success: false,
            found: true,
            matchedItem: bestMatch,
            valid: false,
            message: `"${bestMatch.primary_name}" is not in "${this.currentItem.primary_title}". Try another actor.`
        }
    }

    /**
     * Human picks a movie for the current actor
     */
    _humanPicksMovie(query) {
        // Search for the movie
        const movies = this.searchMovies(query, 5)

        if (movies.length === 0) {
            return {
                success: false,
                found: false,
                message: `Couldn't find any movie matching "${query}". Try again.`
            }
        }

        // Try to find a match that has the current actor
        for (const movie of movies) {
            if (this._validateActorInMovie(this.currentItem.nconst, movie.tconst)) {
                // Check if already used
                if (this.usedMovies.has(movie.tconst)) {
                    return {
                        success: false,
                        found: true,
                        matchedItem: movie,
                        alreadyUsed: true,
                        message: `"${movie.primary_title}" has already been named this round. Try another movie.`
                    }
                }

                // Valid move!
                this.usedMovies.add(movie.tconst)
                this.currentItem = movie
                this.currentItemType = ITEM_TYPE.MOVIE
                this.currentPlayer = PLAYER.COMPUTER

                this._log("Human picked movie:", movie.primary_title)

                this.lastMoveMessage = `You named: ${movie.primary_title} (${movie.start_year})`
                return {
                    success: true,
                    found: true,
                    matchedItem: movie,
                    valid: true,
                    alreadyUsed: false,
                    nextItemType: ITEM_TYPE.ACTOR,
                    nextPlayer: PLAYER.COMPUTER,
                    message: `"${movie.primary_title}" (${movie.start_year}) - correct! Computer's turn to name an actor from this movie.`
                }
            }
        }

        // Found movies but actor not in them
        const bestMatch = movies[0]
        return {
            success: false,
            found: true,
            matchedItem: bestMatch,
            valid: false,
            message: `"${this.currentItem.primary_name}" is not in "${bestMatch.primary_title}". Try another movie.`
        }
    }

    /**
     * Computer takes its turn
     */
    computerMove() {
        if (this.state !== GAME_STATE.PLAYING) {
            return {
                success: false,
                message: `Cannot make a move in state: ${this.state}`
            }
        }

        if (this.currentPlayer !== PLAYER.COMPUTER) {
            return {
                success: false,
                message: "It's not the computer's turn!"
            }
        }

        if (this.currentItemType === ITEM_TYPE.MOVIE) {
            // Computer needs to name an actor from the current movie
            return this._computerPicksActor()
        } else {
            // Computer needs to name a movie with the current actor
            return this._computerPicksMovie()
        }
    }

    /**
     * Computer picks an actor for the current movie
     */
    _computerPicksActor() {
        // Build query excluding used actors
        let query = this.stmtComputerPickActorBase
        const params = [this.currentItem.tconst, this.config.maxOrdering]

        if (this.usedActors.size > 0) {
            const placeholders = [...this.usedActors].map(() => "?").join(",")
            query += ` AND n.nconst NOT IN (${placeholders})`
            params.push(...this.usedActors)
        }

        query += " ORDER BY career_size DESC LIMIT 5"

        const stmt = this.db.prepare(query)
        const candidates = stmt.all(...params)

        if (candidates.length === 0) {
            // Computer can't find anyone - gives up, human wins round
            return this._computerGivesUp()
        }

        // Pick randomly from top candidates (slight randomness)
        const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, 3))]

        this.usedActors.add(pick.nconst)
        this.currentItem = pick
        this.currentItemType = ITEM_TYPE.ACTOR
        this.currentPlayer = PLAYER.HUMAN

        this._log("Computer picked actor:", pick.primary_name)

        this.lastMoveMessage = `Computer named: ${pick.primary_name}`
        return {
            success: true,
            matchedItem: pick,
            nextItemType: ITEM_TYPE.MOVIE,
            nextPlayer: PLAYER.HUMAN,
            message: `Computer says: "${pick.primary_name}". Your turn to name a movie with this actor.`
        }
    }

    /**
     * Computer picks a movie for the current actor
     */
    _computerPicksMovie() {
        // Build query excluding used movies
        // Base params: nconst, maxOrdering, minYear, minVotes
        let query = this.stmtComputerPickMovieBase
        const params = [this.currentItem.nconst, this.config.maxOrdering, this.config.minYear, this.config.minVotes]

        if (this.usedMovies.size > 0) {
            const placeholders = [...this.usedMovies].map(() => "?").join(",")
            query += ` AND t.tconst NOT IN (${placeholders})`
            params.push(...this.usedMovies)
        }

        query += " ORDER BY cast_size DESC, COALESCE(r.num_votes, 0) DESC LIMIT 5"

        const stmt = this.db.prepare(query)
        const candidates = stmt.all(...params)

        if (candidates.length === 0) {
            // Computer can't find anything - gives up, human wins round
            return this._computerGivesUp()
        }

        // Pick randomly from top candidates
        const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, 3))]

        this.usedMovies.add(pick.tconst)
        this.currentItem = pick
        this.currentItemType = ITEM_TYPE.MOVIE
        this.currentPlayer = PLAYER.HUMAN

        this._log("Computer picked movie:", pick.primary_title)

        this.lastMoveMessage = `Computer named: ${pick.primary_title} (${pick.start_year})`
        return {
            success: true,
            matchedItem: pick,
            nextItemType: ITEM_TYPE.ACTOR,
            nextPlayer: PLAYER.HUMAN,
            message: `Computer says: "${pick.primary_title}" (${pick.start_year}). Your turn to name an actor from this movie.`
        }
    }

    /**
     * Computer gives up (can't find a valid answer)
     */
    _computerGivesUp() {
        this._log("Computer gives up!")
        return this._endRound(PLAYER.HUMAN, "Computer couldn't find a valid answer!")
    }

    /**
     * Human issues a challenge
     */
    humanChallenge() {
        if (this.state !== GAME_STATE.PLAYING) {
            return {
                success: false,
                message: `Cannot challenge in state: ${this.state}`
            }
        }

        if (this.currentPlayer !== PLAYER.HUMAN) {
            return {
                success: false,
                message: "You can only challenge when it's your turn!"
            }
        }

        this._log("Human challenges!")

        // Computer must try to prove there's a valid answer
        this.state = GAME_STATE.CHALLENGE_PENDING

        let proofItem = null

        if (this.currentItemType === ITEM_TYPE.MOVIE) {
            // Human was supposed to name an actor - computer proves one exists
            proofItem = this._computerFindProofActor()
        } else {
            // Human was supposed to name a movie - computer proves one exists
            proofItem = this._computerFindProofMovie()
        }

        if (proofItem) {
            // Computer found a valid answer - computer wins
            this._log("Computer proves:", proofItem.primary_name || proofItem.primary_title)
            return this._endRound(
                PLAYER.COMPUTER,
                `Challenge failed! Computer proves: "${proofItem.primary_name || proofItem.primary_title}"`,
                proofItem
            )
        } else {
            // Computer can't prove anything - human wins
            this._log("Computer can't prove anything!")
            return this._endRound(PLAYER.HUMAN, "Challenge successful! Computer had no valid answer.")
        }
    }

    /**
     * Computer tries to find a proof actor (for challenge response)
     */
    _computerFindProofActor() {
        let query = this.stmtComputerPickActorBase
        const params = [this.currentItem.tconst, this.config.maxOrdering]

        if (this.usedActors.size > 0) {
            const placeholders = [...this.usedActors].map(() => "?").join(",")
            query += ` AND n.nconst NOT IN (${placeholders})`
            params.push(...this.usedActors)
        }

        query += " LIMIT 1"

        const stmt = this.db.prepare(query)
        return stmt.get(...params) || null
    }

    /**
     * Computer tries to find a proof movie (for challenge response)
     */
    _computerFindProofMovie() {
        // Base params: nconst, maxOrdering, minYear, minVotes
        let query = this.stmtComputerPickMovieBase
        const params = [this.currentItem.nconst, this.config.maxOrdering, this.config.minYear, this.config.minVotes]

        if (this.usedMovies.size > 0) {
            const placeholders = [...this.usedMovies].map(() => "?").join(",")
            query += ` AND t.tconst NOT IN (${placeholders})`
            params.push(...this.usedMovies)
        }

        query += " LIMIT 1"

        const stmt = this.db.prepare(query)
        return stmt.get(...params) || null
    }

    /**
     * End the current round
     */
    _endRound(winner, message, proofItem = null) {
        this.scores[winner]++

        const gameWinner = this.scores[winner] >= this.roundsToWin ? winner : null

        if (gameWinner) {
            this.state = GAME_STATE.GAME_OVER
            this.winner = gameWinner
            this._log("Game over! Winner:", gameWinner)
        } else {
            this.state = GAME_STATE.ROUND_OVER
            this._log("Round over! Winner:", winner, "Scores:", this.scores)
        }

        this.lastMoveMessage = message

        return {
            success: true,
            roundWinner: winner,
            proofItem,
            scores: { ...this.scores },
            gameWinner,
            message: gameWinner
                ? `${message} ${gameWinner === PLAYER.HUMAN ? "You" : "Computer"} wins the game ${this.scores[PLAYER.HUMAN]}-${this.scores[PLAYER.COMPUTER]}!`
                : `${message} Score: You ${this.scores[PLAYER.HUMAN]} - Computer ${this.scores[PLAYER.COMPUTER]}`
        }
    }

    /**
     * Continue to next round (after round_over state)
     */
    nextRound() {
        if (this.state !== GAME_STATE.ROUND_OVER) {
            return {
                success: false,
                message: `Cannot start next round in state: ${this.state}`
            }
        }

        this.roundNumber++
        this.state = GAME_STATE.PLAYING

        return this.startRound()
    }

    /**
     * Restart the game entirely
     */
    restart() {
        return this.startGame()
    }
}
