"""Term search in clinical text: accent-insensitive, case-insensitive and WHOLE-WORD.

A substring search (`"ar" in text`) matched inside other words ("regul-ar") and marked physical exam
systems as present when they were not.
"""
import re
import unicodedata
from functools import lru_cache


def normalize(text):
    """Lowercase + accent-stripped ('Respiratório' -> 'respiratorio')."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(text).lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


@lru_cache(maxsize=None)
def _word_pattern(term, plural):
    """Compiles `term` into a whole-word regex: `(?<!\\w)` and `(?!\\w)` keep it from matching
    glued to other letters or digits."""
    suffix = r"(?:s|es)?" if plural else ""
    return re.compile(r"(?<!\w)" + re.escape(normalize(term)) + suffix + r"(?!\w)")


def has_word(text_normalized, term, plural=False):
    """True if `term` appears as a whole word (or phrase) in already-normalized text.
    plural=True also accepts the simple plural ('dreno' matches 'drenos')."""
    return _word_pattern(term, plural).search(text_normalized) is not None


def find_words(text, terms, plural=False):
    """Terms from `terms` present in the text (normalizes the text only once)."""
    normalized = normalize(text)
    return [t for t in terms if has_word(normalized, t, plural)]
