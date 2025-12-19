import js from "@eslint/js"
import globals from "globals"

export default [
    js.configs.recommended,
    {
        ignores: ["venv/**", "node_modules/**"]
    },
    {
        files: ["**/*.{js,mjs,cjs}"],
        languageOptions: { globals: globals.node },
        rules: {
            "no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ]
        }
    },
    {
        files: ["web/**/*.js"],
        languageOptions: { globals: { ...globals.browser, io: "readonly" } }
    }
]
