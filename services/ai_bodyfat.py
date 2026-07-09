import json

from services.openai_client import _get_openai_client, encode_image_for_openai


def run_ai_bodyfat_estimate(front_photo, back_photo, height_cm, weight_kg, waist_cm, neck_cm, lighting, pump_status, time_of_day, model_name):
    client, err = _get_openai_client()
    if err:
        return None, err
    if front_photo is None and back_photo is None:
        return None, "Upload at least one physique photo."

    user_text = f"""
Estimate male body fat percentage from physique photos for a fitness tracking app.
Return ONLY valid JSON.

Stats:
- Height: {height_cm} cm
- Bodyweight: {weight_kg} kg
- Waist: {waist_cm if waist_cm and waist_cm > 0 else "Not provided"}
- Neck: {neck_cm if neck_cm and neck_cm > 0 else "Not provided"}
- Lighting: {lighting}
- Pump status: {pump_status}
- Time of day: {time_of_day}

Do not use waist or neck unless provided. Be conservative with flattering lighting or pump.

JSON schema:
{{
  "bf_low": number,
  "bf_high": number,
  "bf_mid": number,
  "confidence": "low" | "medium" | "high",
  "notes": "short practical explanation",
  "fat_storage": "short note",
  "ten_percent_notes": "short note"
}}
"""

    content = [{"type": "input_text", "text": user_text}]
    if front_photo is not None:
        content.append({"type": "input_image", "image_url": encode_image_for_openai(front_photo)})
    if back_photo is not None:
        content.append({"type": "input_image", "image_url": encode_image_for_openai(back_photo)})

    try:
        response = client.responses.create(model=model_name, input=[{"role": "user", "content": content}])
        text = getattr(response, "output_text", None) or str(response)
        data = json.loads(text.strip().replace("```json", "").replace("```", "").strip())
        for key in ["bf_low", "bf_high", "bf_mid", "confidence", "notes"]:
            if key not in data:
                return None, f"AI response missing key: {key}. Raw response: {text[:500]}"
        return data, None
    except Exception as e:
        return None, f"AI estimate failed: {e}"
