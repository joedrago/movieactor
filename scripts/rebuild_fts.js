#!/usr/bin/env node

/**
 * Rebuild FTS Tables Script
 *
 * Rebuilds the FTS5 full-text search tables with diacritic normalization.
 * This allows searching "zoe kravitz" to match "Zoë Kravitz", etc.
 *
 * Usage: node scripts/rebuild_fts.js
 */

import { existsSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import Database from "better-sqlite3"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, "..")
const DB_PATH = join(PROJECT_ROOT, "data", "imdb.db")

/**
 * Normalize text by removing diacritics/accents
 * This allows "zoe" to match "Zoë", "cafe" to match "café", etc.
 */
function normalizeDiacritics(text) {
    return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

async function main() {
    console.log("FTS Table Rebuild Script")
    console.log("========================\n")

    if (!existsSync(DB_PATH)) {
        console.error(`Error: Database not found at ${DB_PATH}`)
        console.error("Run 'npm run imdb' first to create the database.")
        process.exit(1)
    }

    const db = new Database(DB_PATH)

    console.log("Rebuilding FTS tables with diacritic normalization...\n")

    // Rebuild name_basics_fts
    console.log("Step 1: Rebuilding name_basics_fts...")
    db.exec("DROP TABLE IF EXISTS name_basics_fts")
    db.exec(`
        CREATE VIRTUAL TABLE name_basics_fts USING fts5(
            nconst UNINDEXED,
            primary_name,
            tokenize='trigram'
        )
    `)

    const insertNameFts = db.prepare("INSERT INTO name_basics_fts (nconst, primary_name) VALUES (?, ?)")
    const names = db.prepare("SELECT nconst, primary_name FROM name_basics").all()

    console.log(`  Processing ${names.length.toLocaleString()} names...`)
    const insertNamesTransaction = db.transaction((rows) => {
        for (const row of rows) {
            insertNameFts.run(row.nconst, normalizeDiacritics(row.primary_name))
        }
    })
    insertNamesTransaction(names)
    console.log(`  Done: ${names.length.toLocaleString()} names indexed`)

    // Rebuild title_basics_fts
    console.log("\nStep 2: Rebuilding title_basics_fts...")
    db.exec("DROP TABLE IF EXISTS title_basics_fts")
    db.exec(`
        CREATE VIRTUAL TABLE title_basics_fts USING fts5(
            tconst UNINDEXED,
            primary_title,
            tokenize='trigram'
        )
    `)

    const insertTitleFts = db.prepare("INSERT INTO title_basics_fts (tconst, primary_title) VALUES (?, ?)")
    const titles = db
        .prepare(
            "SELECT tconst, primary_title FROM title_basics WHERE title_type IN ('movie', 'tvSeries', 'tvMiniSeries', 'tvMovie', 'video')"
        )
        .all()

    console.log(`  Processing ${titles.length.toLocaleString()} titles...`)
    const insertTitlesTransaction = db.transaction((rows) => {
        for (const row of rows) {
            insertTitleFts.run(row.tconst, normalizeDiacritics(row.primary_title))
        }
    })
    insertTitlesTransaction(titles)
    console.log(`  Done: ${titles.length.toLocaleString()} titles indexed`)

    // Optimize FTS tables
    console.log("\nStep 3: Optimizing FTS tables...")
    db.exec("INSERT INTO name_basics_fts(name_basics_fts) VALUES('optimize')")
    db.exec("INSERT INTO title_basics_fts(title_basics_fts) VALUES('optimize')")

    db.close()

    console.log("\n========================")
    console.log("FTS tables rebuilt successfully!")
    console.log('You can now search for names like "zoe kravitz" to match "Zoë Kravitz"')
}

main().catch((err) => {
    console.error("Error:", err)
    process.exit(1)
})
