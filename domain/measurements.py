from data.sb_ops import df_from_supabase, sb_insert, store_supabase_result


def load_measurements():
    columns = ["date", "bodyweight", "wrist_cm", "forearm_cm", "bicep_cm",
               "chest_cm", "waist_cm", "hips_cm", "thigh_cm", "calf_cm",
               "shoulders_cm", "neck_cm", "notes", "timestamp"]
    return df_from_supabase("measurements", columns)


def save_measurements(row):
    ok, err = sb_insert("measurements", row)
    store_supabase_result("measurements", ok, err)


def latest_measurements():
    df = load_measurements()
    if df.empty:
        return {}
    return df.iloc[-1].to_dict()
