/**
 * LumiIQ - Smart Predictive Dictionary & Autocorrect
 * Custom, lightning-fast prediction engine tailored for paralyzed and bedridden patient environments.
 */

const LumiDictionary = {
    // High-frequency medical and patient-oriented vocabulary
    VOCABULARY: [
        // Nurse / Care
        "nurse", "doctor", "medicine", "pill", "doctor", "injection", "checkup", "caregiver", "physio", "hospital", "bandage",
        // Daily Needs
        "water", "food", "thirsty", "hungry", "toilet", "washroom", "bathroom", "shower", "blanket", "pillow", "sheet",
        "fan", "heater", "light", "window", "door", "remote", "television", "phone", "spectacles", "glasses",
        // Actions
        "call", "help", "need", "want", "feel", "hurt", "pain", "ache", "itch", "move", "sit", "lie", "stand", "breathe",
        "cough", "choke", "sleep", "rest", "wake", "drink", "eat", "speak", "write", "open", "close", "turn", "adjust",
        // States & Feelings
        "cold", "hot", "tired", "sleepy", "dizzy", "nauseous", "uncomfortable", "itchy", "sore", "better", "worse",
        "sad", "happy", "fine", "okay", "scared", "worried", "breathing",
        // Pronouns & Common
        "I", "me", "you", "he", "she", "we", "they", "my", "your", "the", "a", "an", "is", "are", "am", "was", "were",
        "have", "has", "had", "will", "would", "can", "could", "should", "please", "thank", "thanks", "hello", "goodbye",
        "yes", "no", "not", "but", "and", "or", "some", "more", "now", "later", "today", "tonight", "morning", "night",
        // Family
        "son", "daughter", "wife", "husband", "brother", "sister", "friend", "family", "mom", "dad"
    ],

    // Contextual predictive transitions (Bigrams) to predict the NEXT word
    CONTEXT_PREDICTIONS: {
        "": ["I", "need", "please", "call"], // Start word suggestions
        "i": ["need", "want", "feel", "have", "am"],
        "need": ["water", "medicine", "blanket", "toilet", "nurse", "help", "doctor"],
        "want": ["to", "sleep", "water", "food", "blanket", "television", "rest"],
        "feel": ["cold", "hot", "tired", "dizzy", "pain", "better", "worse", "itchy"],
        "please": ["call", "help", "open", "close", "turn", "adjust", "give"],
        "call": ["nurse", "doctor", "family", "my", "emergency"],
        "have": ["pain", "headache", "itch", "fever", "nausea", "trouble"],
        "my": ["head", "arm", "leg", "chest", "stomach", "throat", "eye", "back"],
        "turn": ["on", "off", "up", "down", "the"],
        "open": ["the", "window", "door", "eyes"],
        "close": ["the", "window", "door", "eyes"],
        "the": ["fan", "light", "window", "door", "television", "nurse", "doctor"]
    },

    /**
     * Get predicted words based on the current full sentence and the active word being typed.
     * @param {string} fullText - The entire text in the input field
     * @returns {string[]} - Array of exactly 4 predictions
     */
    getPredictions(fullText) {
        const cleaned = fullText.trim().toLowerCase();

        // Scenario 1: Empty input -> return starting words
        if (!cleaned) {
            return this.getContextSuggestions("");
        }

        const words = cleaned.split(/\s+/);
        const lastWord = words[words.length - 1];

        // Scenario 2: Trailing space -> patient finished a word, predict the NEXT word based on context
        if (fullText.endsWith(" ")) {
            const contextWord = words[words.length - 1];
            return this.getContextSuggestions(contextWord);
        }

        // Scenario 3: Currently typing a word -> filter vocabulary by prefix
        const prefixMatches = this.VOCABULARY.filter(w => w.toLowerCase().startsWith(lastWord));

        // Sort prefix matches: prioritize shorter words and medical ones
        prefixMatches.sort((a, b) => {
            // Prioritize higher-frequency words (e.g. nurse, pain)
            const prio = ["nurse", "help", "pain", "water", "doctor", "toilet"];
            const aIdx = prio.indexOf(a.toLowerCase());
            const bIdx = prio.indexOf(b.toLowerCase());
            if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
            if (aIdx !== -1) return -1;
            if (bIdx !== -1) return 1;
            return a.length - b.length;
        });

        // If we have prefix matches, take them. Fill up the rest with general words.
        let results = [...new Set(prefixMatches)];
        if (results.length < 4) {
            // If prefix match is a known contextual parent, add its predictions
            const possibleContext = this.getContextSuggestions(lastWord);
            results = [...results, ...possibleContext];
        }

        // Final fallback: fill with default starter suggestions
        if (results.length < 4) {
            results = [...results, ...this.getContextSuggestions("")];
        }

        // Ensure exactly 4 unique results and title-case them for readability
        return [...new Set(results)].slice(0, 4).map(w => this.capitalize(w));
    },

    /**
     * Helper to get contextual words based on the last completed word
     */
    getContextSuggestions(word) {
        const key = word.toLowerCase();
        const suggestions = this.CONTEXT_PREDICTIONS[key] || this.CONTEXT_PREDICTIONS[""];
        // If not enough suggestions, pad with starter words
        let result = [...suggestions];
        if (result.length < 4) {
            result = [...result, ...this.CONTEXT_PREDICTIONS[""]];
        }
        return [...new Set(result)].slice(0, 4);
    },

    /**
     * Capitalize first letter of word
     */
    capitalize(str) {
        if (!str) return "";
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    /**
     * Simple Levenshtein distance for spelling autocorrect
     */
    levenshteinDistance(a, b) {
        const tmp = [];
        let i, j;
        for (i = 0; i <= a.length; i++) {
            tmp[i] = [i];
        }
        for (j = 0; j <= b.length; j++) {
            tmp[0][j] = j;
        }
        for (i = 1; i <= a.length; i++) {
            for (j = 1; j <= b.length; j++) {
                tmp[i][j] = Math.min(
                    tmp[i - 1][j] + 1,
                    tmp[i][j - 1] + 1,
                    tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
        }
        return tmp[a.length][b.length];
    },

    /**
     * Auto-corrects a typed word if misspelled, returning the best match from vocabulary.
     * @param {string} word - The word to autocorrect
     * @returns {string} - The corrected word, or the original if no close match is found
     */
    autocorrect(word) {
        if (!word || word.trim() === "") return "";
        const cleanWord = word.trim().toLowerCase();

        // If it's already in the vocabulary, keep it
        if (this.VOCABULARY.includes(cleanWord)) {
            return word;
        }

        let bestMatch = word;
        let minDistance = 3; // Allow maximum edit distance of 2

        for (const vocab of this.VOCABULARY) {
            // Skip short words or highly disparate lengths
            if (Math.abs(vocab.length - cleanWord.length) > 2) continue;

            const dist = this.levenshteinDistance(cleanWord, vocab);
            if (dist < minDistance) {
                minDistance = dist;
                bestMatch = vocab;
            }
        }

        // Return capitalized match if original was capitalized
        const isCapitalized = word.charAt(0) === word.charAt(0).toUpperCase();
        return isCapitalized ? this.capitalize(bestMatch) : bestMatch;
    }
};
