use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Generate TypeScript + Zod models from a stream of JSON values.
///
/// Returns a JSON string so the JS side only crosses the WASM boundary once:
/// `{ raw, typescript, zod, stats: { samples, objects, fields, optionalFields, enums } }`
#[wasm_bindgen]
pub fn generate(input: &str, root_name: &str, detect_enums: bool) -> Result<String, JsValue> {
    let output = json2obj_core::generate(input, root_name, detect_enums)
        .map_err(|error| JsValue::from_str(&error))?;

    let payload = serde_json::json!({
        "raw": output.raw,
        "typescript": output.typescript,
        "zod": output.zod,
        "stats": {
            "samples": output.stats.samples,
            "objects": output.stats.objects,
            "fields": output.stats.fields,
            "optionalFields": output.stats.optional_fields,
            "enums": output.stats.enums,
        },
    });

    Ok(payload.to_string())
}
