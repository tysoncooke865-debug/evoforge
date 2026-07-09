import json

from services.openai_client import _get_openai_client


def run_ai_avatar_analysis(stats, model_name):
    client, err = _get_openai_client()
    if err:
        return None, err

    prompt = f"""
You are creating an RPG-style fitness avatar for a male lifter.

Use this data:
{json.dumps(stats, indent=2)}

Return ONLY valid JSON:
{{
  "character_class": "short class name",
  "build_type": "short build archetype",
  "weak_point_focus": "single priority",
  "ai_summary": "2-3 sentence motivational but honest avatar description",
  "next_evolution": "what must improve to reach the next stage",
  "training_quest": "one practical training quest for the next 7 days"
}}
"""

    try:
        response = client.responses.create(
            model=model_name,
            input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}]}],
        )
        text = getattr(response, "output_text", None) or str(response)
        data = json.loads(text.strip().replace("```json", "").replace("```", "").strip())
        return data, None
    except Exception as e:
        return None, f"AI avatar analysis failed: {e}"
