use crate::infer::{ObjTy, StrMeta, Ty};
use std::collections::HashSet;

pub struct RenderOptions {
    pub root_name: String,
    pub detect_enums: bool,
}

#[derive(Debug, Default, Clone)]
pub struct Stats {
    pub samples: usize,
    pub objects: usize,
    pub fields: usize,
    pub optional_fields: usize,
    pub enums: usize,
}

pub struct Output {
    pub typescript: String,
    pub zod: String,
    pub stats: Stats,
}

pub fn render(root: &Ty, samples: usize, opts: &RenderOptions) -> Output {
    let (typescript, stats) = render_typescript(root, samples, opts);
    let zod = render_zod(root, samples, opts);
    Output {
        typescript,
        zod,
        stats,
    }
}

struct Def {
    name: String,
    lines: Vec<String>,
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

struct TsRenderer<'a> {
    opts: &'a RenderOptions,
    defs: Vec<Def>,
    used: HashSet<String>,
    stats: Stats,
}

impl<'a> TsRenderer<'a> {
    fn new(opts: &'a RenderOptions) -> Self {
        Self {
            opts,
            defs: Vec::new(),
            used: HashSet::new(),
            stats: Stats::default(),
        }
    }

    fn unique(&mut self, base: String) -> String {
        if self.used.insert(base.clone()) {
            return base;
        }
        let mut index = 2;
        loop {
            let candidate = format!("{}{}", base, index);
            if self.used.insert(candidate.clone()) {
                return candidate;
            }
            index += 1;
        }
    }

    fn register(&mut self, obj: &ObjTy, suggested: &str) -> String {
        let name = self.unique(pascal(suggested));
        let mut lines = Vec::with_capacity(obj.fields.len());

        for (key, field) in &obj.fields {
            let ty = self.type_name(&field.ty, &pascal(key));
            let optional = field.missing > 0;
            self.stats.fields += 1;
            if optional {
                self.stats.optional_fields += 1;
            }
            lines.push(format!(
                "  {}{}: {};",
                quote_key(key),
                if optional { "?" } else { "" },
                ty
            ));
        }

        self.defs.push(Def {
            name: name.clone(),
            lines,
        });
        name
    }

    fn type_name(&mut self, ty: &Ty, suggested: &str) -> String {
        match ty {
            Ty::Any => "unknown".to_string(),
            Ty::Null => "null".to_string(),
            Ty::Bool => "boolean".to_string(),
            Ty::Int | Ty::Float => "number".to_string(),
            Ty::Str(meta) => match enum_values(meta, self.opts, suggested) {
                Some(values) => {
                    self.stats.enums += 1;
                    values
                        .iter()
                        .map(|value| serde_json::to_string(value).unwrap())
                        .collect::<Vec<_>>()
                        .join(" | ")
                }
                None => "string".to_string(),
            },
            Ty::Arr(inner) => {
                let element = element_base(&pascal(suggested));
                let inner_ty = self.type_name(inner, &element);
                if inner_ty.contains(" | ") {
                    format!("({})[]", inner_ty)
                } else {
                    format!("{}[]", inner_ty)
                }
            }
            Ty::Obj(obj) => {
                if obj.fields.is_empty() {
                    "Record<string, unknown>".to_string()
                } else {
                    self.register(obj, suggested)
                }
            }
            Ty::Union(variants) => {
                let mut parts = Vec::with_capacity(variants.len());
                let mut nullable = false;
                for variant in variants {
                    if matches!(variant, Ty::Null) {
                        nullable = true;
                    } else {
                        parts.push(self.type_name(variant, suggested));
                    }
                }
                if nullable {
                    parts.push("null".to_string());
                }
                parts.join(" | ")
            }
        }
    }
}

fn render_typescript(root: &Ty, samples: usize, opts: &RenderOptions) -> (String, Stats) {
    let mut renderer = TsRenderer::new(opts);
    let root_alias = pascal(&opts.root_name);
    let mut body = String::new();

    match root {
        Ty::Obj(obj) if !obj.fields.is_empty() => {
            renderer.register(obj, &opts.root_name);
        }
        _ => {
            let ty = renderer.type_name(root, &root_alias);
            body.push_str(&format!("export type {} = {};\n\n", root_alias, ty));
        }
    }

    // Definitions are pushed post-order, so nested types come before their parents.
    for def in &renderer.defs {
        body.push_str(&format!("export interface {} {{\n", def.name));
        for line in &def.lines {
            body.push_str(line);
            body.push('\n');
        }
        body.push_str("}\n\n");
    }

    let header = format!(
        "// Generated from {} JSON sample{}.\n\n",
        samples,
        if samples == 1 { "" } else { "s" }
    );

    let mut stats = renderer.stats;
    stats.samples = samples;
    stats.objects = renderer.defs.len();

    (
        format!("{}{}\n", header, body.trim_end()),
        stats,
    )
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

struct ZodRenderer<'a> {
    opts: &'a RenderOptions,
    defs: Vec<Def>,
    used: HashSet<String>,
}

impl<'a> ZodRenderer<'a> {
    fn new(opts: &'a RenderOptions) -> Self {
        Self {
            opts,
            defs: Vec::new(),
            used: HashSet::new(),
        }
    }

    fn unique(&mut self, base: String) -> String {
        if self.used.insert(base.clone()) {
            return base;
        }
        let mut index = 2;
        loop {
            let candidate = format!("{}{}", base, index);
            if self.used.insert(candidate.clone()) {
                return candidate;
            }
            index += 1;
        }
    }

    fn register(&mut self, obj: &ObjTy, suggested: &str) -> String {
        let name = self.unique(pascal(suggested));
        let mut lines = Vec::with_capacity(obj.fields.len());

        for (key, field) in &obj.fields {
            let mut expr = self.type_expr(&field.ty, &pascal(key));
            if field.missing > 0 {
                expr.push_str(".optional()");
            }
            lines.push(format!("  {}: {},", quote_key(key), expr));
        }

        self.defs.push(Def {
            name: name.clone(),
            lines,
        });
        format!("{}Schema", name)
    }

    fn type_expr(&mut self, ty: &Ty, suggested: &str) -> String {
        match ty {
            Ty::Any => "z.unknown()".to_string(),
            Ty::Null => "z.null()".to_string(),
            Ty::Bool => "z.boolean()".to_string(),
            Ty::Int => "z.number().int()".to_string(),
            Ty::Float => "z.number()".to_string(),
            Ty::Str(meta) => match enum_values(meta, self.opts, suggested) {
                Some(values) => format!(
                    "z.enum([{}])",
                    values
                        .iter()
                        .map(|value| serde_json::to_string(value).unwrap())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                None => "z.string()".to_string(),
            },
            Ty::Arr(inner) => {
                let element = element_base(&pascal(suggested));
                format!("z.array({})", self.type_expr(inner, &element))
            }
            Ty::Obj(obj) => {
                if obj.fields.is_empty() {
                    "z.record(z.string(), z.unknown())".to_string()
                } else {
                    self.register(obj, suggested)
                }
            }
            Ty::Union(variants) => {
                let nullable = variants.iter().any(|variant| matches!(variant, Ty::Null));
                let mut parts = Vec::new();
                for variant in variants {
                    if matches!(variant, Ty::Null) {
                        continue;
                    }
                    parts.push(self.type_expr(variant, suggested));
                }

                let expr = match parts.len() {
                    0 => "z.null()".to_string(),
                    1 => parts.remove(0),
                    _ => format!("z.union([{}])", parts.join(", ")),
                };

                if nullable && !expr.starts_with("z.null") {
                    format!("{}.nullable()", expr)
                } else {
                    expr
                }
            }
        }
    }
}

fn render_zod(root: &Ty, samples: usize, opts: &RenderOptions) -> String {
    let mut renderer = ZodRenderer::new(opts);
    let root_alias = pascal(&opts.root_name);
    let mut tail = String::new();

    match root {
        Ty::Obj(obj) if !obj.fields.is_empty() => {
            // The definition loop below already emits both the schema and
            // `export type Root = z.infer<...>` for the root object.
            renderer.register(obj, &opts.root_name);
        }
        _ => {
            let expr = renderer.type_expr(root, &root_alias);
            tail.push_str(&format!(
                "export const {}Schema = {};\nexport type {} = z.infer<typeof {}Schema>;\n",
                root_alias, expr, root_alias, root_alias
            ));
        }
    }

    let mut defs = String::new();
    for def in &renderer.defs {
        defs.push_str(&format!(
            "export const {}Schema = z.object({{\n",
            def.name
        ));
        for line in &def.lines {
            defs.push_str(line);
            defs.push('\n');
        }
        defs.push_str("});\n");
        defs.push_str(&format!(
            "export type {} = z.infer<typeof {}Schema>;\n\n",
            def.name, def.name
        ));
    }

    let header = format!(
        "import {{ z }} from \"zod\";\n\n// Generated from {} JSON sample{}.\n\n",
        samples,
        if samples == 1 { "" } else { "s" }
    );

    format!("{}{}\n", header, format!("{}{}", defs, tail).trim_end())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn enum_values(meta: &StrMeta, opts: &RenderOptions, suggested: &str) -> Option<Vec<String>> {
    if !opts.detect_enums || meta.overflow {
        return None;
    }

    // A couple of observations are never enough evidence for an enum.
    if meta.total < 6 || is_free_text_key(suggested) {
        return None;
    }

    let count = meta.values.len();
    if !(2..=8).contains(&count) {
        return None;
    }

    // Each value should show up roughly twice on average. This rejects fields
    // where every row has a different value (IDs, names, timestamps, ...).
    if meta.total < count as u64 * 2 {
        return None;
    }

    if meta.values.iter().any(|value| {
        value.is_empty()
            || value.chars().count() > 40
            || value.contains('\n')
            || value.contains('\r')
            || looks_like_date(value)
    }) {
        return None;
    }

    let all_numeric = meta
        .values
        .iter()
        .all(|value| value.parse::<f64>().is_ok());
    let all_emails = meta.values.iter().all(|value| value.contains('@'));
    if all_numeric || all_emails {
        return None;
    }

    Some(meta.values.iter().cloned().collect())
}

/// Field names that almost always hold free-form values, even when a small
/// sample happens to repeat them often enough to look like an enum.
fn is_free_text_key(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "name"
            | "fullname"
            | "firstname"
            | "lastname"
            | "username"
            | "nickname"
            | "title"
            | "description"
            | "desc"
            | "email"
            | "address"
            | "url"
            | "link"
            | "phone"
            | "mobile"
            | "sku"
            | "barcode"
            | "remark"
            | "comment"
            | "note"
            | "message"
            | "content"
            | "text"
            | "path"
            | "filename"
            | "password"
            | "token"
            | "uuid"
            | "guid"
            | "id"
    )
}

fn looks_like_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 10
        && bytes[0..4].iter().all(|byte| byte.is_ascii_digit())
        && bytes[4] == b'-'
        && bytes[7] == b'-'
}

pub fn pascal(input: &str) -> String {
    let mut out = String::new();
    for part in input.split(|ch: char| !ch.is_alphanumeric()) {
        if part.is_empty() {
            continue;
        }
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
        }
    }

    if out.is_empty() {
        "Type".to_string()
    } else if out.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        format!("T{}", out)
    } else {
        out
    }
}

fn element_base(suggested: &str) -> String {
    let lower = suggested.to_lowercase();
    let singular = if lower.ends_with("ies") && suggested.len() > 3 {
        format!("{}y", &suggested[..suggested.len() - 3])
    } else if lower.ends_with("ses")
        || lower.ends_with("xes")
        || lower.ends_with("zes")
        || lower.ends_with("ches")
        || lower.ends_with("shes")
    {
        suggested[..suggested.len() - 2].to_string()
    } else if lower.ends_with('s') && !lower.ends_with("ss") && suggested.len() > 1 {
        suggested[..suggested.len() - 1].to_string()
    } else {
        suggested.to_string()
    };

    if singular == suggested {
        format!("{}Item", suggested)
    } else {
        singular
    }
}

fn quote_key(key: &str) -> String {
    if is_identifier(key) {
        key.to_string()
    } else {
        serde_json::to_string(key).unwrap()
    }
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(ch) if ch == '_' || ch == '$' || ch.is_alphabetic() => {}
        _ => return false,
    }
    chars.all(|ch| ch == '_' || ch == '$' || ch.is_alphanumeric())
}
