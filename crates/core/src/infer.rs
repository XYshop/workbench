use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Hard cap on how many distinct strings we keep per field while inferring enums.
/// Beyond this the field is treated as an open string and the values are dropped.
pub const MAX_ENUM_VALUES: usize = 40;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct StrMeta {
    pub values: BTreeSet<String>,
    pub overflow: bool,
    pub total: u64,
}

impl StrMeta {
    pub fn push(&mut self, value: &str) {
        self.total += 1;
        if self.overflow {
            return;
        }
        if self.values.len() < MAX_ENUM_VALUES || self.values.contains(value) {
            self.values.insert(value.to_string());
        } else {
            self.overflow = true;
            self.values.clear();
        }
    }

    fn merge(&mut self, other: &StrMeta) {
        self.total += other.total;
        if self.overflow || other.overflow {
            self.overflow = true;
            self.values.clear();
            return;
        }
        for value in &other.values {
            if self.values.len() >= MAX_ENUM_VALUES && !self.values.contains(value) {
                self.overflow = true;
                self.values.clear();
                return;
            }
            self.values.insert(value.clone());
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Field {
    pub ty: Ty,
    /// Number of object observations that contained this key.
    pub seen: u64,
    /// Number of object observations that did not contain this key.
    pub missing: u64,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ObjTy {
    pub fields: BTreeMap<String, Field>,
    /// Number of object instances merged into this shape.
    pub instances: u64,
}

impl ObjTy {
    fn merge(&mut self, other: &ObjTy) {
        let self_instances = self.instances;
        let other_instances = other.instances;

        for (key, field) in self.fields.iter_mut() {
            if !other.fields.contains_key(key) {
                field.missing += other_instances;
            }
        }

        for (key, other_field) in &other.fields {
            if let Some(field) = self.fields.get_mut(key) {
                let current = std::mem::take(&mut field.ty);
                field.ty = merge_ty(current, other_field.ty.clone());
                field.seen += other_field.seen;
                field.missing += other_field.missing;
            } else {
                let mut field = other_field.clone();
                field.missing += self_instances;
                self.fields.insert(key.clone(), field);
            }
        }

        self.instances += other_instances;
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub enum Ty {
    #[default]
    Any,
    Null,
    Bool,
    Int,
    Float,
    Str(StrMeta),
    Arr(Box<Ty>),
    Obj(ObjTy),
    /// Product type. Variants are de-duplicated by kind, capped at four.
    Union(Vec<Ty>),
}

pub fn infer_value(value: &Value) -> Ty {
    match value {
        Value::Null => Ty::Null,
        Value::Bool(_) => Ty::Bool,
        Value::Number(number) => {
            if number.is_f64() {
                Ty::Float
            } else {
                Ty::Int
            }
        }
        Value::String(text) => {
            let mut meta = StrMeta::default();
            meta.push(text);
            Ty::Str(meta)
        }
        Value::Array(items) => {
            let mut inner = Ty::Any;
            for item in items {
                inner = merge_ty(inner, infer_value(item));
            }
            Ty::Arr(Box::new(inner))
        }
        Value::Object(map) => {
            let mut obj = ObjTy::default();
            for (key, value) in map {
                obj.fields.insert(
                    key.clone(),
                    Field {
                        ty: infer_value(value),
                        seen: 1,
                        missing: 0,
                    },
                );
            }
            obj.instances = 1;
            Ty::Obj(obj)
        }
    }
}

pub fn merge_ty(a: Ty, b: Ty) -> Ty {
    match (a, b) {
        (Ty::Any, b) => b,
        (a, Ty::Any) => a,

        (Ty::Null, Ty::Null) => Ty::Null,
        (Ty::Null, b) => Ty::Union(vec![Ty::Null, b]),
        (a, Ty::Null) => Ty::Union(vec![a, Ty::Null]),

        (Ty::Int, Ty::Float) | (Ty::Float, Ty::Int) => Ty::Float,

        (Ty::Str(mut left), Ty::Str(right)) => {
            left.merge(&right);
            Ty::Str(left)
        }
        (Ty::Arr(left), Ty::Arr(right)) => Ty::Arr(Box::new(merge_ty(*left, *right))),
        (Ty::Obj(mut left), Ty::Obj(right)) => {
            left.merge(&right);
            Ty::Obj(left)
        }

        (Ty::Union(left), Ty::Union(right)) => {
            let mut merged = Ty::Union(left);
            for variant in right {
                merged = merge_ty(merged, variant);
            }
            merged
        }
        (Ty::Union(mut variants), other) => merge_into_union(&mut variants, other),
        (other, Ty::Union(mut variants)) => merge_into_union(&mut variants, other),

        // At this point only identical scalar kinds are left.
        (a, b) if a == b => a,
        (a, b) => Ty::Union(vec![a, b]),
    }
}

fn merge_into_union(variants: &mut Vec<Ty>, other: Ty) -> Ty {
    if let Some(position) = variants.iter().position(|existing| same_kind(existing, &other)) {
        let existing = variants.remove(position);
        variants.insert(position, merge_ty(existing, other));
        return Ty::Union(std::mem::take(variants));
    }

    if variants.len() < 4 {
        variants.push(other);
        Ty::Union(std::mem::take(variants))
    } else {
        // Too many shapes to be useful. Fall back to `unknown`.
        Ty::Any
    }
}

fn same_kind(a: &Ty, b: &Ty) -> bool {
    matches!(
        (a, b),
        (Ty::Null, Ty::Null)
            | (Ty::Bool, Ty::Bool)
            | (Ty::Int, Ty::Int)
            | (Ty::Int, Ty::Float)
            | (Ty::Float, Ty::Int)
            | (Ty::Float, Ty::Float)
            | (Ty::Str(_), Ty::Str(_))
            | (Ty::Arr(_), Ty::Arr(_))
            | (Ty::Obj(_), Ty::Obj(_))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn infer(input: &str) -> Ty {
        let value: Value = serde_json::from_str(input).unwrap();
        infer_value(&value)
    }

    #[test]
    fn merges_optional_fields() {
        let left = infer(r#"{"a": 1}"#);
        let right = infer(r#"{"b": "x"}"#);
        let merged = merge_ty(left, right);
        let Ty::Obj(obj) = merged else { panic!("expected object") };
        assert_eq!(obj.instances, 2);
        assert_eq!(obj.fields["a"].missing, 1);
        assert_eq!(obj.fields["b"].missing, 1);
    }

    #[test]
    fn merges_array_items() {
        let value = infer(r#"[{"a": 1}, {"a": 2.5}, {"a": 3}]"#);
        let Ty::Arr(inner) = value else { panic!("expected array") };
        let Ty::Obj(obj) = *inner else { panic!("expected object") };
        assert_eq!(obj.fields["a"].ty, Ty::Float);
        assert_eq!(obj.fields["a"].missing, 0);
    }

    #[test]
    fn tracks_nullability() {
        let merged = merge_ty(infer(r#"{"a": null}"#), infer(r#"{"a": "x"}"#));
        let Ty::Obj(obj) = merged else { panic!("expected object") };
        assert!(matches!(obj.fields["a"].ty, Ty::Union(_)));
    }
}
