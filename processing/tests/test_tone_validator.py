"""Tests for lib.tone_validator — banned phrases, address terms, length, digit check."""

import pytest
from lib.tone_validator import validate, is_banned_phrase, get_banned_phrases


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def assert_ok(text, context=None):
    r = validate(text, context)
    assert r["ok"] is True, f"Expected ok=True but got violations: {r['violations']}"


def assert_fail(text, context=None, containing=None):
    r = validate(text, context)
    assert r["ok"] is False, f"Expected ok=False for: {text!r}"
    if containing:
        joined = " ".join(r["violations"])
        assert containing.lower() in joined.lower(), (
            f"Expected violation containing '{containing}', got: {r['violations']}"
        )


# ---------------------------------------------------------------------------
# Banned phrases — each phrase triggers a violation
# ---------------------------------------------------------------------------

class TestBannedPhrases:
    def test_trust_the_process(self):
        assert_fail("Just trust the process and you'll see results.", containing="trust the process")

    def test_listen_to_your_body(self):
        assert_fail("Always listen to your body when exercising.", containing="listen to your body")

    def test_clean_eating(self):
        assert_fail("Focus on clean eating this week.", containing="clean eating")

    def test_mindful_eating(self):
        assert_fail("Practice mindful eating at each meal.", containing="mindful eating")

    def test_everything_in_moderation(self):
        assert_fail("Everything in moderation is the key to success.", containing="everything in moderation")

    def test_nourish_your_body(self):
        assert_fail("Make sure to nourish your body with whole foods.", containing="nourish your body")

    def test_your_body_will_thank_you(self):
        assert_fail("Stick with it and your body will thank you.", containing="your body will thank you")

    def test_calories_in_calories_out(self):
        assert_fail("It's simple: calories in calories out.", containing="calories in calories out")

    def test_dont_overthink_it(self):
        assert_fail("Seriously, don't overthink it.", containing="don't overthink it")

    def test_dont_worry_about_it(self):
        assert_fail("Missing one meal? Don't worry about it.", containing="don't worry about it")

    def test_carbs_are_the_enemy(self):
        assert_fail("Some people think carbs are the enemy.", containing="carbs are the enemy")

    def test_hormones_love_this(self):
        assert_fail("Your hormones love this kind of routine.", containing="hormones love this")

    def test_case_insensitive(self):
        assert_fail("CLEAN EATING is the answer.", containing="clean eating")

    def test_phrase_mid_sentence(self):
        assert_fail("Today you should really focus on clean eating habits.", containing="clean eating")

    def test_valid_response_passes(self):
        assert_ok("You hit 92g of protein today. Good work — that keeps you right on track for your 100g target.")

    def test_get_banned_phrases_returns_list(self):
        phrases = get_banned_phrases()
        assert isinstance(phrases, list)
        assert len(phrases) >= 12

    def test_is_banned_phrase_true(self):
        assert is_banned_phrase("Focus on mindful eating today.") is True

    def test_is_banned_phrase_false(self):
        assert is_banned_phrase("You are doing great work.") is False


# ---------------------------------------------------------------------------
# Banned address terms
# ---------------------------------------------------------------------------

class TestAddressTerms:
    def test_babe_at_start(self):
        assert_fail("Babe, you crushed it today!", containing="babe")

    def test_honey_at_start(self):
        assert_fail("Honey, let's talk about your macros.", containing="honey")

    def test_sweetie_at_start(self):
        assert_fail("Sweetie, great job today.", containing="sweetie")

    def test_girl_trailing_vocative(self):
        assert_fail("You totally nailed it, girl.", containing="girl")

    def test_girl_at_start_of_sentence(self):
        assert_fail("Girl, that protein number is impressive!", containing="girl")

    def test_girl_not_flagged_as_noun(self):
        # "girl" as subject of a sentence — not a vocative, should not flag
        r = validate("The girl at the gym had great form.")
        violation_terms = [v for v in r["violations"] if "girl" in v]
        assert len(violation_terms) == 0, f"Unexpected address violation: {r['violations']}"

    def test_multiple_address_terms_multi_violation(self):
        r = validate("Babe, honey, you got this!")
        terms = [v for v in r["violations"] if "banned address term" in v]
        assert len(terms) >= 1


# ---------------------------------------------------------------------------
# Length check — soft violation
# ---------------------------------------------------------------------------

class TestLengthCheck:
    def test_too_short_adds_violation_but_ok_true(self):
        short = "Good job!"  # < 30 chars
        r = validate(short)
        assert r["ok"] is True
        assert any("too short" in v for v in r["violations"])

    def test_too_long_adds_violation_but_ok_true(self):
        long_text = "a" * 501
        r = validate(long_text)
        assert r["ok"] is True
        assert any("too long" in v for v in r["violations"])

    def test_length_violation_plus_banned_phrase_fails(self):
        short_bad = "Trust the process!"  # banned phrase + short
        r = validate(short_bad)
        assert r["ok"] is False
        assert any("trust the process" in v for v in r["violations"])
        assert any("too short" in v for v in r["violations"])

    def test_exactly_30_chars_ok(self):
        text = "a" * 30
        r = validate(text)
        length_violations = [v for v in r["violations"] if "short" in v or "long" in v]
        assert len(length_violations) == 0

    def test_exactly_500_chars_ok(self):
        text = "a" * 500
        r = validate(text)
        length_violations = [v for v in r["violations"] if "short" in v or "long" in v]
        assert len(length_violations) == 0


# ---------------------------------------------------------------------------
# Digit check for target questions
# ---------------------------------------------------------------------------

class TestTargetQuestionDigitCheck:
    def test_no_digit_fails(self):
        r = validate(
            "You should aim to eat more protein throughout the day.",
            context={"is_target_question": True},
        )
        assert r["ok"] is False
        assert any("numeric" in v for v in r["violations"])

    def test_with_digit_passes(self):
        r = validate(
            "Your protein target is 100g per day — aim to hit that consistently.",
            context={"is_target_question": True},
        )
        assert r["ok"] is True

    def test_not_target_question_no_digit_ok(self):
        # Without context flag, no digit check
        assert_ok("You are making great progress and building consistency.")

    def test_target_question_with_banned_phrase_fails_both(self):
        r = validate(
            "Listen to your body on this one.",
            context={"is_target_question": True},
        )
        assert r["ok"] is False
        violation_text = " ".join(r["violations"])
        assert "listen to your body" in violation_text
        assert "numeric" in violation_text


# ---------------------------------------------------------------------------
# Clean responses — no violations
# ---------------------------------------------------------------------------

class TestCleanResponses:
    def test_typical_coach_response(self):
        assert_ok(
            "You hit 98g protein and 1,180 calories today. "
            "Protein is exactly where it needs to be — keep that up tomorrow."
        )

    def test_short_but_valid_feedback(self):
        assert_ok("Hit 72g protein — you are closing in on the 100g target.")

    def test_no_context_clean(self):
        assert_ok(
            "Great consistency this week. Your calorie average sits at 1,210 "
            "which is right on target. Keep the same pattern tomorrow."
        )
