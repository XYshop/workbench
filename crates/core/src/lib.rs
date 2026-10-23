//! json2obj-core
//!
//! Infer TypeScript interfaces and Zod schemas from one or more JSON samples.
//! No I/O, no WASM: this crate is usable from a CLI, a Tauri app or the browser.

pub mod infer;
pub mod render;

pub use render::{Output, Stats};

/// Parse a stream of JSON values and render models for them.
///
/// `input` may contain a single document, several concatenated documents or
/// JSON Lines. Every document is treated as one sample, which is what makes
/// optional-field and enum inference useful in the first place.
pub fn generate(input: &str, root_name: &str, detect_enums: bool) -> Result<Output, String> {
    let deserializer = serde_json::Deserializer::from_str(input);
    let mut root = infer::Ty::Any;
    let mut samples = 0usize;
    let mut raw_samples = Vec::new();

    for value in deserializer.into_iter::<serde_json::Value>() {
        let value = value.map_err(|error| format!("JSON 解析失败：{}", error))?;
        root = infer::merge_ty(root, infer::infer_value(&value));
        raw_samples.push(
            serde_json::to_string_pretty(&value)
                .map_err(|error| format!("JSON 格式化失败：{}", error))?,
        );
        samples += 1;
    }

    if samples == 0 {
        return Err("没有检测到 JSON 数据".to_string());
    }

    let name = root_name.trim();
    let opts = render::RenderOptions {
        root_name: if name.is_empty() { "Root" } else { name }.to_string(),
        detect_enums,
    };

    let mut output = render::render(&root, samples, &opts);
    output.raw = raw_samples.join("\n");
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_simple_object() {
        let out = generate(r#"{"id": 1, "name": "Ada"}"#, "Root", true).unwrap();

        assert!(out.typescript.contains("export interface Root {"));
        assert!(out.typescript.contains("id: number;"));
        assert!(out.typescript.contains("name: string;"));
        assert!(out.zod.contains("export const RootSchema = z.object({"));
        assert!(out.zod.contains("id: z.number().int(),"));
    }

    #[test]
    fn marks_missing_fields_as_optional() {
        let out = generate("{\"a\": 1}\n{\"b\": 2}", "Root", true).unwrap();

        assert!(out.typescript.contains("a?: number;"));
        assert!(out.typescript.contains("b?: number;"));
        assert!(out.zod.contains("a: z.number().int().optional(),"));
        assert_eq!(out.stats.optional_fields, 2);
    }

    #[test]
    fn merges_nested_array_objects_and_detects_enums() {
        let input = r#"{
            "users": [
                {"id": 1, "role": "admin"},
                {"id": 2, "role": "user"},
                {"id": 3, "role": "admin"},
                {"id": 4, "role": "guest"},
                {"id": 5, "role": "admin"},
                {"id": 6, "role": "user"}
            ]
        }"#;
        let out = generate(input, "Root", true).unwrap();

        assert!(out.typescript.contains("users: User[];"));
        assert!(out.typescript.contains("export interface User {"));
        assert!(out
            .typescript
            .contains(r#"role: "admin" | "guest" | "user";"#));
        assert!(out.zod.contains(r#"z.enum(["admin", "guest", "user"])"#));
    }

    #[test]
    fn does_not_treat_names_as_enums() {
        let input = "{\"name\":\"Ada\"}\n{\"name\":\"Bob\"}\n{\"name\":\"Cara\"}\n{\"name\":\"Ada\"}\n{\"name\":\"Bob\"}\n{\"name\":\"Ada\"}";
        let out = generate(input, "Root", true).unwrap();

        assert!(out.typescript.contains("name: string;"));
        assert!(!out.typescript.contains(r#"name: "Ada""#));
    }

    #[test]
    fn handles_root_arrays() {
        let out = generate(r#"[{"id": 1}, {"id": 2}]"#, "Root", true).unwrap();

        assert!(out.typescript.contains("export type Root = RootItem[];"));
        assert!(out.typescript.contains("export interface RootItem"));
    }

    #[test]
    fn handles_nullable_fields() {
        let out = generate("{\"a\": null}\n{\"a\": \"x\"}", "Root", true).unwrap();

        assert!(out.typescript.contains("a: string | null;"));
        assert!(out.zod.contains("z.string().nullable()"));
    }

    #[test]
    fn quotes_invalid_property_names() {
        let out = generate(r#"{"user-name": "x"}"#, "Root", true).unwrap();

        assert!(out.typescript.contains(r#""user-name": string;"#));
    }

    #[test]
    fn rejects_empty_and_invalid_input() {
        assert!(generate("   ", "Root", true).is_err());
        assert!(generate("{", "Root", true).is_err());
    }
}
