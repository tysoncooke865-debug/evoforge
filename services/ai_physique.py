import json

from config.constants import EXERCISE_LIBRARY
from services.openai_client import _get_openai_client, encode_uploaded_image


def run_ai_physique_rating(front_photo, side_photo, back_photo, stats, model_name):
    client, err = _get_openai_client()
    if err:
        return None, err
    if front_photo is None and side_photo is None and back_photo is None:
        return None, "Upload at least one physique photo."

    user_text = f"""
Rate this male physique for an aesthetic fitness app. Do not identify the person.
Return ONLY valid JSON.

Stats:
{json.dumps(stats, indent=2)}

JSON schema:
{{
  "physique_score": number,
  "leanness_score": number,
  "symmetry_score": number,
  "muscularity_score": number,
  "confidence": "low" | "medium" | "high",
  "weak_points": ["short point", "short point", "short point"],
  "improvements": ["short actionable improvement", "short actionable improvement", "short actionable improvement"],
  "summary": "short honest summary",
  "training_priority": ["Chest", "Side delts", "Back width", "Arms", "Legs", "Abs"]
}}

Scores are out of 15. Be realistic and useful.
"""

    content = [{"type": "input_text", "text": user_text}]
    if front_photo is not None:
        content.append({"type": "input_image", "image_url": encode_uploaded_image(front_photo)})
    if side_photo is not None:
        content.append({"type": "input_image", "image_url": encode_uploaded_image(side_photo)})
    if back_photo is not None:
        content.append({"type": "input_image", "image_url": encode_uploaded_image(back_photo)})

    try:
        response = client.responses.create(model=model_name, input=[{"role": "user", "content": content}])
        text = getattr(response, "output_text", None) or str(response)
        data = json.loads(text.strip().replace("```json", "").replace("```", "").strip())
        for key in ["physique_score", "leanness_score", "symmetry_score", "muscularity_score", "confidence", "weak_points", "improvements", "summary"]:
            if key not in data:
                return None, f"AI response missing key: {key}. Raw response: {text[:500]}"
        return data, None
    except Exception as e:
        return None, f"AI physique rating failed: {e}"


def run_ai_custom_plan_from_physique(rating, measurements, goals, model_name):
    client, err = _get_openai_client()
    if err:
        return None, err

    prompt = f"""
You are an expert bodybuilding coach making a custom workout plan for an aesthetic-focused lifter.

DO NOT simply repeat the user's current PPPPLA routine.
Choose exercises from this exercise library:
{json.dumps(EXERCISE_LIBRARY, indent=2)}

Physique rating:
{json.dumps(rating, indent=2)}

Measurements:
{json.dumps(measurements, indent=2)}

Goal:
{goals}

Create a 6-day split:
Push 1 - Strength Bias
Pull 1 - Width Bias
Push 2 - Hypertrophy Bias
Pull 2 - Thickness Bias
Legs
Aesthetic Weakpoint Day

Each day: 5-8 exercises. Include exercise, sets, reps, reason.
Return ONLY valid JSON:
{{
  "plan_name": "string",
  "rationale": "short summary",
  "weekly_focus": ["focus 1", "focus 2", "focus 3"],
  "days": [
    {{
      "day": "Push 1 - Strength Bias",
      "goal": "short day goal",
      "exercises": [
        {{"exercise": "exercise name", "sets": 3, "reps": "8-12", "reason": "why selected"}}
      ]
    }}
  ]
}}
"""
    try:
        response = client.responses.create(model=model_name, input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}])
        text = getattr(response, "output_text", None) or str(response)
        data = json.loads(text.strip().replace("```json", "").replace("```", "").strip())
        if "days" not in data:
            return None, f"AI response missing 'days'. Raw: {text[:500]}"
        return data, None
    except Exception as e:
        return None, f"AI custom plan failed: {e}"
